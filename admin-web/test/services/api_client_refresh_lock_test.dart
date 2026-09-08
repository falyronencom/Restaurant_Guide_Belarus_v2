import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/services/session_events.dart';

import '../helpers/wire_stand.dart';

/// Обновление токена: одно на всех, повтор без цикла, провал с одним
/// сигналом.
///
/// Refresh-токен на бэкенде одноразовый (`authService.js`: `used_at`,
/// `REFRESH_TOKEN_REUSE_DETECTED` отзывает все токены пользователя). Панель
/// на старте и после четырёх часов простоя получает 401 сразу на несколько
/// запросов; без замка каждый из них запускал бы своё обновление, первое
/// проходило, остальные выжигали сессию. Повторённый после обновления
/// запрос, получив 401 снова, не должен обновлять токен ещё раз — иначе
/// цикл «обновить-повторить» без дна.
void main() {
  late Map<String, String> storage;
  var expired = 0;

  setUp(() {
    storage = installSecureStorageStand(
      initial: {'access_token': 'stale', 'refresh_token': 'r1'},
    );
    expired = 0;
    SessionEvents.debugReset();
    SessionEvents.expired.listen((_) => expired++);
  });

  String? bearer(RequestOptions o) => o.headers['Authorization'] as String?;

  /// Транспорт «сессия жива, access-токен протух»: защищённый GET отвечает
  /// 401 на `stale` и 200 на `fresh`; обновление отдаёт `fresh` + `r2`.
  StubAdapter liveSession({bool retriedStillRejected = false}) =>
      StubAdapter((o) {
        if (o.uri.path == '/api/v1/auth/refresh') {
          return jsonBody({
            'success': true,
            'data': {'accessToken': 'fresh', 'refreshToken': 'r2'},
          });
        }
        if (retriedStillRejected || bearer(o) != 'Bearer fresh') {
          return jsonBody(
            rejectedBody('TOKEN_EXPIRED', 'Token expired'),
            status: 401,
          );
        }
        return jsonBody({'success': true, 'data': {'ok': o.uri.path}});
      });

  test('два параллельных 401 делят одно обновление, оба повторяются свежим',
      () async {
    final adapter = liveSession();
    final api = stubClient(adapter);

    final results = await Future.wait([
      api.get('/api/v1/admin/badges'),
      api.get('/api/v1/admin/quality/health'),
    ]);

    expect(results.map((r) => r.statusCode), [200, 200]);
    final paths = adapter.requests.map((r) => r.uri.path).toList();
    expect(paths.where((p) => p == '/api/v1/auth/refresh').length, 1,
        reason: 'второе обновление тем же токеном сервер счёл бы повторным '
            'использованием и отозвал бы все токены');
    expect(paths.length, 5, reason: 'два исходных, одно обновление, два повтора');
    expect(storage['access_token'], 'fresh');
    expect(storage['refresh_token'], 'r2');
    expect(expired, 0);
  });

  test('повторённый запрос, получив 401 снова, не обновляет токен ещё раз',
      () async {
    final adapter = liveSession(retriedStillRejected: true);
    final api = stubClient(adapter);

    final error = await api
        .get('/api/v1/admin/badges')
        .then<Object?>((_) => null, onError: (Object e) => e);

    expect(error, isA<DioException>());
    expect((error as DioException).error, 'Token expired',
        reason: 'отказ повтора — настоящий ответ сервера, его и отдаём');
    expect(
      adapter.requests.map((r) => r.uri.path).toList(),
      ['/api/v1/admin/badges', '/api/v1/auth/refresh', '/api/v1/admin/badges'],
      reason: 'исходный, одно обновление, один повтор — и всё',
    );
    expect(expired, 0, reason: 'сессия не мертва: обновление прошло');
  });

  test('упорный 5xx: три повтора и отказ, а не повтор без предела', () async {
    final adapter = StubAdapter(
      (o) => jsonBody(
        rejectedBody('INTERNAL_ERROR', 'Something broke'),
        status: 503,
      ),
      maxRequests: 12,
    );
    final api = stubClient(adapter);

    final error = await api
        .get('/api/v1/admin/badges')
        .timeout(const Duration(seconds: 20))
        .then<Object?>((_) => null, onError: (Object e) => e);

    expect(error, isA<DioException>());
    // Исходный запрос + Environment.maxRetryAttempts (3) повтора. Без
    // переноса `extra` в повтор счётчик каждый раз начинался с нуля.
    expect(adapter.requests.length, 4,
        reason: 'счётчик повторов обязан переезжать в повторённый запрос');
    expect(expired, 0);
  });

  test('окно деплоя: 5xx на обновлении не стирает сессию и не объявляет её истёкшей',
      () async {
    var refreshCalls = 0;
    final adapter = StubAdapter(
      (o) {
        if (o.uri.path == '/api/v1/auth/refresh') {
          refreshCalls++;
          return jsonBody({'error': 'bad gateway'}, status: 502);
        }
        return jsonBody(
          rejectedBody('TOKEN_EXPIRED', 'Token expired'),
          status: 401,
        );
      },
      maxRequests: 12,
    );
    final api = stubClient(adapter);

    final error = await api
        .get('/api/v1/admin/badges')
        .timeout(const Duration(seconds: 20))
        .then<Object?>((_) => null, onError: (Object e) => e);

    expect(error, isA<DioException>());
    expect((error as DioException).error,
        'Service temporarily unavailable. Please try again.',
        reason: 'запросу — временная ошибка, а не «войдите снова»');
    expect(refreshCalls, 4, reason: 'исходное обновление + 3 повтора, не без предела');
    expect(expired, 0, reason: 'сессия жива — уводить на вход нельзя');
    expect(storage['refresh_token'], 'r1',
        reason: 'ещё действующий refresh-токен нельзя выбрасывать по 502');
    expect(storage['access_token'], 'stale');
  });

  test('мёртвый refresh-токен при двух параллельных 401: одно обновление, один сигнал',
      () async {
    final adapter = StubAdapter((o) => jsonBody(
          rejectedBody('REFRESH_TOKEN_EXPIRED', 'Refresh token expired'),
          status: 401,
        ));
    final api = stubClient(adapter);

    final errors = await Future.wait([
      api.get('/api/v1/admin/badges').then<Object?>((_) => null, onError: (Object e) => e),
      api.get('/api/v1/admin/quality/health').then<Object?>((_) => null, onError: (Object e) => e),
    ]);

    expect(errors, everyElement(isA<DioException>()));
    expect(
      errors.map((e) => (e! as DioException).error).toSet(),
      {'Authentication failed. Please log in again.'},
    );
    final paths = adapter.requests.map((r) => r.uri.path).toList();
    expect(paths.where((p) => p == '/api/v1/auth/refresh').length, 1);
    expect(expired, 1, reason: 'провайдер уводит на вход один раз, не дважды');
    expect(storage.containsKey('access_token'), isFalse);
    expect(storage.containsKey('refresh_token'), isFalse);
  });
}
