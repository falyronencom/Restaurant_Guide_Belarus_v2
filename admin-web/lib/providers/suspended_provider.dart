import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/services/account_scope.dart';
import 'package:restaurant_guide_admin_web/services/moderation_service.dart';

/// State management for the "Приостановленные" (Suspended) screen.
///
/// Manages:
/// - Suspended establishments list with pagination
/// - Detail loading for selected establishment
/// - Unsuspend action (returns establishment to active status)
class SuspendedProvider extends ChangeNotifier {
  /// Размер страницы — как у сервиса и как в подписи «Показано N–M из T».
  static const int perPage = 20;

  final ModerationService _service = ModerationService();

  SuspendedProvider() {
    AccountScope.register(resetAccountScope);
  }

  // List state
  List<SuspendedEstablishmentItem> _establishments = [];
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

  // Action state
  bool _isSubmitting = false;
  String? _submitError;

  /// Сброс при смене аккаунта: список, выбранная карточка и ход действия
  /// принадлежат вошедшему.
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
    _isSubmitting = false;
    _submitError = null;
    notifyListeners();
  }

  // Getters
  List<SuspendedEstablishmentItem> get establishments => _establishments;
  bool get isLoadingList => _isLoadingList;
  String? get listError => _listError;
  int get currentPage => _currentPage;
  int get totalPages => _totalPages;
  int get totalCount => _totalCount;

  EstablishmentDetail? get selectedDetail => _selectedDetail;
  bool get isLoadingDetail => _isLoadingDetail;
  String? get detailError => _detailError;
  String? get selectedId => _selectedId;
  bool get isSubmitting => _isSubmitting;
  String? get submitError => _submitError;

  /// Load suspended establishments
  Future<void> loadSuspendedEstablishments({int page = 1}) async {
    _isLoadingList = true;
    _listError = null;
    notifyListeners();

    try {
      final result = await _service.getSuspendedEstablishments(page: page);

      _establishments = result.establishments;
      _currentPage = result.page;
      _totalPages = result.pages;
      _totalCount = result.total;
      _isLoadingList = false;

      // Stale selection check (lesson from Testing Session 5)
      if (_selectedId != null &&
          !_establishments.any((e) => e.id == _selectedId)) {
        _selectedId = null;
        _selectedDetail = null;
        _detailError = null;
        _submitError = null;
      }

      notifyListeners();
    } catch (e) {
      _isLoadingList = false;
      _listError = _extractMessage(e);
      notifyListeners();
    }
  }

  /// Select establishment and load its detail
  Future<void> selectEstablishment(String id) async {
    if (_selectedId == id && _selectedDetail != null) return;

    _selectedId = id;
    _isLoadingDetail = true;
    _detailError = null;
    _submitError = null;
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

  /// Unsuspend the currently selected establishment (suspended → active)
  Future<bool> unsuspendEstablishment() async {
    if (_selectedId == null) return false;

    _isSubmitting = true;
    _submitError = null;
    notifyListeners();

    try {
      await _service.unsuspendEstablishment(id: _selectedId!);

      // Remove from list and clear selection
      _establishments.removeWhere((e) => e.id == _selectedId);
      _totalCount = (_totalCount - 1).clamp(0, _totalCount);
      _selectedId = null;
      _selectedDetail = null;
      _isSubmitting = false;
      notifyListeners();
      _reloadIfPageEmptied();
      return true;

    } catch (e) {
      _isSubmitting = false;
      _submitError = _extractMessage(e);
      notifyListeners();
      return false;
    }
  }

  /// Clear selection
  void clearSelection() {
    _selectedId = null;
    _selectedDetail = null;
    _detailError = null;
    _submitError = null;
    notifyListeners();
  }

  String _extractMessage(Object error) {
    final msg = error.toString();
    if (msg.contains('403')) return 'Доступ запрещён';
    if (msg.contains('404')) return 'Заведение не найдено';
    if (msg.contains('400')) return 'Некорректный запрос';
    if (msg.contains('SocketException') || msg.contains('Connection')) {
      return 'Ошибка соединения с сервером';
    }
    return 'Произошла ошибка';
  }

  /// «Возобновить» могло убрать единственную запись открытой страницы.
  /// Приостановленных при этом меньше не стало настолько, чтобы раздел
  /// опустел, — поэтому список перечитывается с зажатым номером страницы.
  void _reloadIfPageEmptied() {
    if (_establishments.isNotEmpty || _totalCount == 0) return;

    final lastPage = (_totalCount + perPage - 1) ~/ perPage;
    loadSuspendedEstablishments(
      page: _currentPage > lastPage ? lastPage : _currentPage,
    );
  }

}
