import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/services/account_scope.dart';
import 'package:restaurant_guide_admin_web/services/moderation_service.dart';

/// Per-field review state during moderation session
enum FieldReviewStatus { neutral, approved, rejected }

class FieldReviewState {
  final FieldReviewStatus status;
  final String? comment;

  const FieldReviewState({
    this.status = FieldReviewStatus.neutral,
    this.comment,
  });

  FieldReviewState copyWith({FieldReviewStatus? status, String? comment}) {
    return FieldReviewState(
      status: status ?? this.status,
      comment: comment ?? this.comment,
    );
  }
}

/// Названия вкладок панели модерации — в порядке их показа.
const List<String> kModerationTabTitles = <String>[
  'Данные',
  'О заведении',
  'Медиа',
  'Адрес',
];

/// Поля, разложенные по вкладкам. Единственный источник правды о составе
/// проверки: 5 + 6 + 2 + 1 = 14.
///
/// Три числа на экране считаются отсюда — прогресс в шапке, счётчики на
/// вкладках и «осталось проверить» в нижней панели. Если каждое из них
/// считать по месту, они разъедутся ровно тогда, когда состав полей
/// изменится, и модератор увидит «3 из 14» над вкладками, дающими в сумме 15.
/// Порядок групп обязан совпадать с порядком вкладок в
/// `ModerationDetailPanel`.
const List<List<String>> kModerationTabFields = <List<String>>[
  <String>[
    'legal_name',
    'unp',
    'registration_doc',
    'contact_person',
    'contact_email',
  ],
  <String>[
    'description',
    'name',
    'customer_phone',
    'website',
    'working_hours',
    'price_range',
  ],
  <String>['photos', 'menu'],
  <String>['address'],
];

/// Сколько полных суток заявка ждёт очереди.
///
/// Отсчёт от `updated_at`, а не от `created_at`: партнёр может держать
/// черновик неделями, и ожиданием это не является — очередь начинается с
/// отправки на модерацию, которая и есть последняя запись в строку. Бэкенд
/// сортирует очередь тем же полем (`ORDER BY e.updated_at ASC`), поэтому
/// бейджи в списке идут строго по убыванию, а подпись шапки сходится с
/// верхней карточкой.
///
/// Расхождение с `oldest_pending_at` на дашборде — осознанное: тот считает
/// по `created_at` и закреплён тестом с явной формулировкой «время создания».
/// Это разные экраны; внутри одного экрана все числа сходятся.
int? moderationWaitingDays(DateTime? since, {DateTime? now}) {
  if (since == null) return null;
  final reference = now ?? DateTime.now();
  final days = reference.difference(since).inDays;
  return days < 0 ? 0 : days;
}

/// State management for the moderation workflow
class ModerationProvider with ChangeNotifier {
  final ModerationService _service;

  // Pending list state
  List<EstablishmentListItem> _establishments = [];
  bool _isLoadingList = false;
  String? _listError;
  int _currentPage = 1;
  int _totalPages = 1;
  int _totalCount = 0;

  // Selected establishment state
  EstablishmentDetail? _selectedDetail;
  bool _isLoadingDetail = false;
  String? _detailError;
  String? _selectedId;

  // Per-field review state (field_name → state)
  Map<String, FieldReviewState> _fieldReviews = {};

  // Moderation action state
  bool _isSubmitting = false;
  String? _submitError;

  ModerationProvider({ModerationService? service})
      : _service = service ?? ModerationService() {
    AccountScope.register(resetAccountScope);
  }

  /// Сброс при смене аккаунта. Вердикты по полям — работа модератора, и
  /// переносить их на следующего вошедшего нельзя так же, как с одной заявки
  /// на другую. Ответ на летящую загрузку детали выбросится сам: он сверяет
  /// свой id с `_selectedId`, а тот обнулён.
  void resetAccountScope() {
    _establishments = [];
    _isLoadingList = false;
    _listError = null;
    _currentPage = 1;
    _totalPages = 1;
    _totalCount = 0;
    _selectedDetail = null;
    _isLoadingDetail = false;
    _detailError = null;
    _selectedId = null;
    _fieldReviews = {};
    _isSubmitting = false;
    _submitError = null;
    notifyListeners();
  }

  // ============================================================================
  // Getters
  // ============================================================================

  List<EstablishmentListItem> get establishments => _establishments;
  bool get isLoadingList => _isLoadingList;
  String? get listError => _listError;
  int get currentPage => _currentPage;
  int get totalPages => _totalPages;
  int get totalCount => _totalCount;

  EstablishmentDetail? get selectedDetail => _selectedDetail;
  bool get isLoadingDetail => _isLoadingDetail;
  String? get detailError => _detailError;
  String? get selectedId => _selectedId;

  Map<String, FieldReviewState> get fieldReviews => _fieldReviews;

  // ============================================================================
  // Прогресс проверки — производное от _fieldReviews, считается в одном месте
  // ============================================================================

  /// Поле считается проверенным, когда по нему вынесен вердикт. Комментарий
  /// без вердикта проверкой не является: `commentField` оставляет статус
  /// `neutral`, и модератор, написавший заметку, поле ещё не закрыл.
  bool _isChecked(String fieldName) =>
      (_fieldReviews[fieldName] ?? const FieldReviewState()).status !=
      FieldReviewStatus.neutral;

  /// Сколько полей на каждой вкладке — [5, 6, 2, 1].
  List<int> get tabFieldCounts =>
      kModerationTabFields.map((fields) => fields.length).toList(growable: false);

  /// Сколько проверено на каждой вкладке.
  List<int> get tabCheckedCounts => kModerationTabFields
      .map((fields) => fields.where(_isChecked).length)
      .toList(growable: false);

  int get totalFieldCount =>
      kModerationTabFields.fold(0, (sum, fields) => sum + fields.length);

  int get checkedFieldCount =>
      kModerationTabFields.fold(0, (sum, fields) => sum + fields.where(_isChecked).length);

  int get remainingFieldCount => totalFieldCount - checkedFieldCount;

  /// Доля проверенного — для полосы прогресса. 0.0 при пустом составе полей.
  double get checkedFraction =>
      totalFieldCount == 0 ? 0 : checkedFieldCount / totalFieldCount;

  /// Сколько полей отклонено — нижняя панель называет это число вслух.
  int get rejectedFieldCount => kModerationTabFields.fold(
        0,
        (sum, fields) =>
            sum +
            fields
                .where(
                  (name) =>
                      (_fieldReviews[name] ?? const FieldReviewState()).status ==
                      FieldReviewStatus.rejected,
                )
                .length,
      );

  /// Хотя бы одно поле отклонено.
  bool get hasRejectedField => rejectedFieldCount > 0;

  /// Одобрение запрещено ровно одним условием — есть отклонённое поле.
  ///
  /// Требовать вердикт по всем четырнадцати полям макет не просит, и вводить
  /// такой шлюз самостоятельно нельзя: это меняет работу модератора, а не
  /// оформление экрана. Отклонённое поле блокирует одобрение потому, что
  /// одобрить отклонённое — противоречие, а не потому, что «мало проверено».
  bool get canApprove => !hasRejectedField;

  /// Сколько ждёт старейшая заявка из загруженных. `null` — очередь пуста.
  ///
  /// Считается по загруженному списку, а не отдельным запросом: очередь
  /// приходит отсортированной по возрастанию `updated_at`, поэтому максимум
  /// лежит в первом элементе. Минимум по списку берётся всё равно — так
  /// подпись остаётся верной и на второй странице («старейшая из показанных»),
  /// когда пагинацию сюда добавят.
  int? get oldestWaitingDays {
    DateTime? oldest;
    for (final item in _establishments) {
      final stamp = item.updatedAt;
      if (stamp == null) continue;
      if (oldest == null || stamp.isBefore(oldest)) oldest = stamp;
    }
    return moderationWaitingDays(oldest);
  }

  bool get isSubmitting => _isSubmitting;
  String? get submitError => _submitError;

  // ============================================================================
  // List operations
  // ============================================================================

  Future<void> loadPendingEstablishments({int page = 1}) async {
    _isLoadingList = true;
    _listError = null;
    notifyListeners();

    try {
      final response = await _service.getPendingEstablishments(page: page);
      _establishments = response.establishments;
      _currentPage = response.page;
      _totalPages = response.pages;
      _totalCount = response.total;

      // Clear stale selection if the selected item is no longer in the list
      if (_selectedId != null &&
          !_establishments.any((e) => e.id == _selectedId)) {
        _selectedId = null;
        _selectedDetail = null;
        _fieldReviews = {};
        _detailError = null;
        _submitError = null;
      }
    } catch (e) {
      _listError = _extractMessage(e);
    } finally {
      _isLoadingList = false;
      notifyListeners();
    }
  }

  // ============================================================================
  // Detail operations
  // ============================================================================

  /// Открыть карточку из очереди.
  ///
  /// Обнуление вердиктов принадлежит смене заявки, а не загрузке данных:
  /// переносить проверку с одной карточки на другую нельзя, а повторное
  /// открытие той же карточки заявку не меняет, и проверка обязана уцелеть.
  /// Поэтому `_fieldReviews` чистится по условию `_selectedId != id`, а не
  /// на каждом входе сюда.
  Future<void> selectEstablishment(String id) async {
    // Повтор по уже открытой и успешно загруженной карточке — ничего не
    // делаем. Ошибка загрузки исключение: повторный тап по той же строке и
    // есть «попробовать снова», иначе панель остаётся с ошибкой навсегда.
    if (_selectedId == id && _selectedDetail != null && _detailError == null) {
      return;
    }

    if (_selectedId != id) {
      // Другая заявка — вердикты предыдущей к ней не относятся.
      _fieldReviews = {};
    }

    _selectedId = id;
    _submitError = null;
    await _reloadSelectedDetail();
  }

  /// Перечитать деталь уже выбранной карточки, не трогая вердикты.
  ///
  /// Отдельный путь нужен затем, что перезагрузка своей же карточки — не
  /// смена заявки. Раньше её делали через [selectEstablishment], и правка
  /// координат стирала всю проверку: прогресс в шапке на глазах падал
  /// с «9 из 14» до «0 из 14», а модератор не понимал, куда делась работа.
  Future<void> _reloadSelectedDetail() async {
    final id = _selectedId;
    if (id == null) return;

    _isLoadingDetail = true;
    _detailError = null;
    notifyListeners();

    EstablishmentDetail? loaded;
    String? failure;
    try {
      loaded = await _service.getEstablishmentDetails(id);
    } catch (e) {
      failure = _extractMessage(e);
    }

    // Пока ответ шёл, модератор мог открыть другую карточку. Тогда этот
    // ответ уже не о ней: положить его в `_selectedDetail` значит показать
    // чужие данные под её именем — и вердикты по ним ушли бы не в ту заявку.
    // Флаг загрузки тоже не трогаем: его держит более свежий запрос.
    if (_selectedId != id) return;

    // При сбое прежняя деталь остаётся на месте: она устарела, но это всё
    // ещё та самая карточка, и обнулять её ради сообщения об ошибке незачем.
    if (loaded != null) _selectedDetail = loaded;
    _detailError = failure;
    _isLoadingDetail = false;
    notifyListeners();
  }

  void clearSelection() {
    _selectedId = null;
    _selectedDetail = null;
    _fieldReviews = {};
    _detailError = null;
    _submitError = null;
    notifyListeners();
  }

  // ============================================================================
  // Field review operations
  // ============================================================================

  void approveField(String fieldName) {
    _fieldReviews[fieldName] = const FieldReviewState(
      status: FieldReviewStatus.approved,
    );
    notifyListeners();
  }

  void rejectField(String fieldName, {String? comment}) {
    _fieldReviews[fieldName] = FieldReviewState(
      status: FieldReviewStatus.rejected,
      comment: comment,
    );
    notifyListeners();
  }

  void commentField(String fieldName, String comment) {
    final current = _fieldReviews[fieldName] ?? const FieldReviewState();
    _fieldReviews[fieldName] = current.copyWith(comment: comment);
    notifyListeners();
  }

  void resetField(String fieldName) {
    _fieldReviews.remove(fieldName);
    notifyListeners();
  }

  FieldReviewState getFieldState(String fieldName) {
    return _fieldReviews[fieldName] ?? const FieldReviewState();
  }

  // ============================================================================
  // Moderation actions
  // ============================================================================

  Future<bool> approveEstablishment() async {
    if (_selectedId == null) return false;

    _isSubmitting = true;
    _submitError = null;
    notifyListeners();

    try {
      // Collect all field comments (both approved and rejected)
      final notes = <String, String>{};
      for (final entry in _fieldReviews.entries) {
        if (entry.value.comment != null && entry.value.comment!.isNotEmpty) {
          notes[entry.key] = entry.value.comment!;
        }
      }

      await _service.moderateEstablishment(
        id: _selectedId!,
        action: 'approve',
        moderationNotes: notes,
      );

      // Remove from list and clear selection
      _establishments.removeWhere((e) => e.id == _selectedId);
      _totalCount = (_totalCount - 1).clamp(0, _totalCount);
      clearSelection();
      return true;
    } catch (e) {
      _submitError = _extractMessage(e);
      return false;
    } finally {
      _isSubmitting = false;
      notifyListeners();
    }
  }

  Future<bool> rejectEstablishment() async {
    if (_selectedId == null) return false;

    _isSubmitting = true;
    _submitError = null;
    notifyListeners();

    try {
      // Collect per-field rejection notes
      final notes = <String, String>{};
      for (final entry in _fieldReviews.entries) {
        if (entry.value.status == FieldReviewStatus.rejected &&
            entry.value.comment != null &&
            entry.value.comment!.isNotEmpty) {
          notes[entry.key] = entry.value.comment!;
        }
      }

      await _service.moderateEstablishment(
        id: _selectedId!,
        action: 'reject',
        moderationNotes: notes,
      );

      // Remove from list and clear selection
      _establishments.removeWhere((e) => e.id == _selectedId);
      _totalCount = (_totalCount - 1).clamp(0, _totalCount);
      clearSelection();
      return true;
    } catch (e) {
      _submitError = _extractMessage(e);
      return false;
    } finally {
      _isSubmitting = false;
      notifyListeners();
    }
  }

  // ============================================================================
  // Coordinate correction
  // ============================================================================

  /// Update establishment coordinates (admin correction)
  Future<bool> updateCoordinates(double latitude, double longitude) async {
    if (_selectedId == null) return false;

    _isSubmitting = true;
    _submitError = null;
    notifyListeners();

    try {
      await _service.updateCoordinates(
        id: _selectedId!,
        latitude: latitude,
        longitude: longitude,
      );

      // Перечитать деталь, чтобы показать новые координаты. Именно
      // перечитать: [selectEstablishment] обнуляет вердикты, и правка
      // координат стирала бы проверку по всем четырнадцати полям.
      await _reloadSelectedDetail();

      _isSubmitting = false;
      notifyListeners();
      return true;
    } catch (e) {
      _submitError = _extractMessage(e);
      _isSubmitting = false;
      notifyListeners();
      return false;
    }
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  String _extractMessage(Object error) {
    final msg = error.toString();
    if (msg.contains('Connection timeout')) return 'Превышено время ожидания';
    if (msg.contains('No internet')) return 'Нет подключения к серверу';
    if (msg.contains('403')) return 'Доступ запрещён';
    if (msg.contains('404')) return 'Заведение не найдено';
    return 'Произошла ошибка. Попробуйте снова.';
  }
}
