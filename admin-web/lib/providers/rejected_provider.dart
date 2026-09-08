import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/services/account_scope.dart';
import 'package:restaurant_guide_admin_web/services/moderation_service.dart';

/// State management for the "Отказанные" (Rejected) screen.
///
/// Loads rejection history from audit log. Purely informational —
/// no action buttons, read-only detail view.
class RejectedProvider extends ChangeNotifier {
  /// Размер страницы — как у сервиса и как в подписи «Показано N–M из T».
  static const int perPage = 20;

  final ModerationService _service = ModerationService();

  RejectedProvider() {
    AccountScope.register(resetAccountScope);
  }

  // List state
  List<RejectedEstablishmentItem> _rejections = [];
  bool _isLoadingList = false;
  String? _listError;
  int _currentPage = 1;
  int _totalPages = 1;
  int _totalCount = 0;

  // Selected detail state
  EstablishmentDetail? _selectedDetail;
  bool _isLoadingDetail = false;
  String? _detailError;
  String? _selectedId;

  // Currently selected rejection item (for rejection notes)
  RejectedEstablishmentItem? _selectedRejection;

  /// Сброс при смене аккаунта: история и выбранная карточка принадлежат
  /// вошедшему.
  void resetAccountScope() {
    _rejections = [];
    _isLoadingList = false;
    _listError = null;
    _currentPage = 1;
    _totalPages = 1;
    _totalCount = 0;
    _selectedDetail = null;
    _isLoadingDetail = false;
    _detailError = null;
    _selectedId = null;
    _selectedRejection = null;
    notifyListeners();
  }

  // Getters
  List<RejectedEstablishmentItem> get rejections => _rejections;
  bool get isLoadingList => _isLoadingList;
  String? get listError => _listError;
  int get currentPage => _currentPage;
  int get totalPages => _totalPages;
  int get totalCount => _totalCount;

  EstablishmentDetail? get selectedDetail => _selectedDetail;
  bool get isLoadingDetail => _isLoadingDetail;
  String? get detailError => _detailError;
  String? get selectedId => _selectedId;
  RejectedEstablishmentItem? get selectedRejection => _selectedRejection;

  /// Load rejection history
  Future<void> loadRejectedEstablishments({int page = 1}) async {
    _isLoadingList = true;
    _listError = null;
    notifyListeners();

    try {
      final result = await _service.getRejectedEstablishments(page: page);

      _rejections = result.rejections;
      _currentPage = result.page;
      _totalPages = result.pages;
      _totalCount = result.total;
      _isLoadingList = false;

      // Clear stale selection if the selected item is no longer in the list
      if (_selectedId != null &&
          !_rejections.any((e) => e.establishmentId == _selectedId)) {
        _selectedId = null;
        _selectedDetail = null;
        _selectedRejection = null;
        _detailError = null;
      }

      notifyListeners();
    } catch (e) {
      _isLoadingList = false;
      _listError = _extractMessage(e);
      notifyListeners();
    }
  }

  /// Select a rejected establishment and load its detail
  Future<void> selectEstablishment(RejectedEstablishmentItem rejection) async {
    final id = rejection.establishmentId;
    if (_selectedId == id && _selectedDetail != null) return;

    _selectedId = id;
    _selectedRejection = rejection;
    _isLoadingDetail = true;
    _detailError = null;
    notifyListeners();

    try {
      _selectedDetail = await _service.getEstablishmentDetails(id);
      _isLoadingDetail = false;
      notifyListeners();
    } catch (e) {
      _isLoadingDetail = false;
      _detailError = _extractMessage(e);
      notifyListeners();
    }
  }

  /// Clear selection
  void clearSelection() {
    _selectedId = null;
    _selectedDetail = null;
    _selectedRejection = null;
    _detailError = null;
    notifyListeners();
  }

  String _extractMessage(Object error) {
    final msg = error.toString();
    if (msg.contains('403')) return 'Доступ запрещён';
    if (msg.contains('404')) return 'Заведение не найдено';
    if (msg.contains('SocketException') || msg.contains('Connection')) {
      return 'Ошибка соединения с сервером';
    }
    return 'Произошла ошибка';
  }
}
