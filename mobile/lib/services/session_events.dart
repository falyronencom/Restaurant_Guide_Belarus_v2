import 'dart:async';

import 'package:flutter/foundation.dart';

/// Событие «сессия истекла окончательно».
///
/// Транспорт (`ApiClient`) узнаёт об этом первым: обновить токен не удалось,
/// хранилище очищено. До этого события провайдер авторизации о случившемся
/// не знал вовсе и оставался в состоянии «вошёл» с пустым хранилищем: профиль
/// показывал данные, за которыми уже нельзя сходить, а каждое действие
/// отвечало «Сеанс истёк». Зеркало `admin-web/lib/services/session_events.dart`.
///
/// Шина статическая и не идёт через `AuthService` намеренно: сервис в тестах
/// подменяется фейком через `implements`, и новый обязательный член сломал бы
/// каждый такой стенд. Подписчик один — `AuthProvider`.
class SessionEvents {
  SessionEvents._();

  // `sync: true`: подписчик переводит состояние в тот же момент, когда
  // транспорт отверг запрос, — без лишнего кадра, на котором экран ещё
  // «вошёл», а токенов уже нет.
  static StreamController<void> _controller =
      StreamController<void>.broadcast(sync: true);

  static Stream<void> get expired => _controller.stream;

  /// Сообщить, что обновить сессию больше нельзя.
  static void reportExpired() {
    if (!_controller.isClosed) _controller.add(null);
  }

  /// Только для изоляции тестов — новая шина без прежних подписчиков.
  @visibleForTesting
  static void debugReset() {
    _controller.close();
    _controller = StreamController<void>.broadcast(sync: true);
  }
}
