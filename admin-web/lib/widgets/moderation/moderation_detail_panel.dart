import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/panel_roles.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/utils/open_url.dart';
import 'package:restaurant_guide_admin_web/widgets/media/media_viewer.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/providers/moderation_provider.dart';
import 'package:restaurant_guide_admin_web/services/moderation_service.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/definition_grid.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_field_review.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/status_dot.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_inline_spinner.dart';

/// Display mode for the detail panel
enum DetailPanelMode {
  /// Full moderation review with per-field approve/reject/comment (Segment B)
  moderation,

  /// Read-only view — no action buttons on fields or at bottom
  readonly,

  /// Read-only + unsuspend action available
  suspended,
}

/// Right panel: tabbed detail view for reviewing a single establishment.
///
/// Four tabs: Данные, О заведении, Медиа, Адрес.
///
/// Supports three modes:
/// - [DetailPanelMode.moderation]: Approve/reject buttons (original Segment B)
/// - [DetailPanelMode.readonly]: Display only (approved / rejected screens)
/// - [DetailPanelMode.suspended]: Display + unsuspend action
///
/// When [detail], [selectedId], etc. are provided, uses them directly.
/// When null, falls back to reading [ModerationProvider] (backward compatible).
class ModerationDetailPanel extends StatefulWidget {
  final DetailPanelMode mode;

  // Optional external data (when null, reads from ModerationProvider)
  final EstablishmentDetail? detail;
  final bool? isLoadingDetail;
  final String? detailError;
  final String? selectedId;

  // Действия над заведением живут в шапке экрана — см.
  // [ModerationEntityActions]. Панель их не принимает намеренно: приостановка
  // и назначение партнёра относятся к заведению целиком, а не к открытой
  // вкладке, и место им в слоте шапки.

  // Rejection notes for per-field display (from audit log)
  final Map<String, dynamic>? rejectionNotes;

  const ModerationDetailPanel({
    super.key,
    this.mode = DetailPanelMode.moderation,
    this.detail,
    this.isLoadingDetail,
    this.detailError,
    this.selectedId,
    this.rejectionNotes,
  });

  @override
  State<ModerationDetailPanel> createState() => _ModerationDetailPanelState();
}

class _ModerationDetailPanelState extends State<ModerationDetailPanel>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Resolve data: external params or ModerationProvider
    final String? selectedId;
    final bool isLoadingDetail;
    final String? detailError;
    final EstablishmentDetail? detail;
    final bool isReadOnly = widget.mode != DetailPanelMode.moderation;

    if (widget.detail != null ||
        widget.selectedId != null ||
        widget.isLoadingDetail != null) {
      // External data mode
      selectedId = widget.selectedId;
      isLoadingDetail = widget.isLoadingDetail ?? false;
      detailError = widget.detailError;
      detail = widget.detail;
    } else {
      // Provider mode (backward compatible with Segment B)
      final provider = context.watch<ModerationProvider>();
      selectedId = provider.selectedId;
      isLoadingDetail = provider.isLoadingDetail;
      detailError = provider.detailError;
      detail = provider.selectedDetail;
    }

    if (selectedId == null) {
      return const Center(
        child: Text(
          'Выберите заведение для просмотра',
          style: TextStyle(fontSize: 16, color: Colors.grey),
        ),
      );
    }

    if (isLoadingDetail) {
      return const Center(child: CircularProgressIndicator());
    }

    if (detailError != null) {
      return Center(
        child: Text(
          detailError,
          style: const TextStyle(color: Colors.red),
        ),
      );
    }

    if (detail == null) return const SizedBox.shrink();

    return Column(
      children: [
        // Шапка панели — только в режиме чтения. В модерации имя заведения
        // показывает выбранная карточка очереди (кадр 05), и второй заголовок
        // на том же экране был бы повтором.
        if (isReadOnly) _PanelHeader(detail: detail),

        // Rejection notes summary (for rejected screen)
        if (widget.rejectionNotes != null &&
            widget.rejectionNotes!.isNotEmpty)
          _RejectionNotesBlock(notes: widget.rejectionNotes!),

        if (widget.mode == DetailPanelMode.suspended)
          _SuspensionBlock(
            notes: detail.moderationNotes,
            authorName: detail.suspendedByName,
          ),

        // Вкладки. Стили не задаются на месте: активная 15/600 тёмно-оранжевым
        // с подчёркиванием 2px и нижняя граница полосы приходят из
        // tabBarTheme канона. Раньше здесь стоял кегль 18 и чёрный цвет
        // неактивной — они перекрывали тему.
        _buildTabBar(
          context,
          showCounts: widget.mode == DetailPanelMode.moderation,
          mediaCount: detail.interiorPhotos.length + detail.menuMedia.length,
        ),

        // Tab content
        Expanded(
          child: TabBarView(
            controller: _tabController,
            children: [
              _DataTab(
                detail: detail,
                isReadOnly: isReadOnly,
              ),
              _AboutTab(
                detail: detail,
                isReadOnly: isReadOnly,
              ),
              _MediaTab(
                detail: detail,
                isReadOnly: isReadOnly,
              ),
              _AddressTab(
                detail: detail,
                isReadOnly: isReadOnly,
                onUpdateCoordinates: (lat, lon) {
                  context.read<ModerationProvider>().updateCoordinates(lat, lon);
                },
              ),
            ],
          ),
        ),

        // Action buttons (only in moderation mode)
        if (widget.mode == DetailPanelMode.moderation)
          _ActionBar(provider: context.watch<ModerationProvider>()),
      ],
    );
  }

  /// Полоса вкладок. В режиме модерации у каждой стоит «проверено/всего».
  ///
  /// Счётчики только здесь: на «Одобренных» и «Отказанных» та же панель
  /// работает на чтение, вердиктов там не выносят, и «0/5» было бы враньём
  /// о наличии работы.
  ///
  /// [AnimatedBuilder] нужен ради цвета счётчика — он различается у активной
  /// и неактивной вкладки, а значит зависит от `_tabController.index`.
  /// Перерисовка ограничена полосой, тело вкладок её не касается.
  Widget _buildTabBar(
    BuildContext context, {
    required bool showCounts,
    required int mediaCount,
  }) {
    final provider = showCounts ? context.watch<ModerationProvider>() : null;

    return AnimatedBuilder(
      animation: _tabController,
      builder: (context, _) => TabBar(
        controller: _tabController,
        tabAlignment: TabAlignment.start,
        isScrollable: true,
        tabs: <Widget>[
          for (var i = 0; i < kModerationTabTitles.length; i++)
            Tab(
              child: provider == null
                  // Счётчик у «Медиа» в режиме чтения означает СКОЛЬКО
                  // файлов, а не «проверено из всего», как в модерации.
                  // Внешне элемент тот же, смысл другой — поэтому и цвет
                  // приглушённый, без доли.
                  ? (i == 2 && mediaCount > 0
                      ? Text.rich(
                          TextSpan(
                            children: <InlineSpan>[
                              TextSpan(text: kModerationTabTitles[i]),
                              TextSpan(
                                text: '  $mediaCount',
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: AppTheme.textGrey,
                                ),
                              ),
                            ],
                          ),
                        )
                      : Text(kModerationTabTitles[i]))
                  : Text.rich(
                      TextSpan(
                        children: <InlineSpan>[
                          TextSpan(text: kModerationTabTitles[i]),
                          TextSpan(
                            text: ' ${provider.tabCheckedCounts[i]}'
                                '/${provider.tabFieldCounts[i]}',
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w500,
                              color: _tabController.index == i
                                  ? AppTheme.textSecondary
                                  : AppTheme.textGrey,
                            ),
                          ),
                        ],
                      ),
                    ),
            ),
        ],
      ),
    );
  }
}

// =============================================================================
// Header Action Bar (Suspend / Unsuspend)
// =============================================================================

/// Действия над выбранным заведением — слот шапки экрана.
///
/// Раньше эти кнопки жили полосой внутри панели разбора, под её собственным
/// заголовком. Кадры 11 и 13 ставят их в шапку экрана, и это правильнее по
/// существу: приостановить или назначить партнёра — действия над заведением
/// целиком, а не над той вкладкой, которая сейчас открыта.
///
/// Виджет рисует только кнопки: имя заведения показывает шапка панели.
class ModerationEntityActions extends StatelessWidget {
  final ValueChanged<String>? onSuspend;
  final VoidCallback? onUnsuspend;
  final ValueChanged<String>? onClaim;
  final String establishmentName;

  const ModerationEntityActions({
    super.key,
    this.onSuspend,
    this.onUnsuspend,
    this.onClaim,
    required this.establishmentName,
  });

  /// Кнопка слота шапки: высота 40, r10 — как у соседних контролов.
  static ButtonStyle _action({Color? color, double borderWidth = 1}) =>
      OutlinedButton.styleFrom(
        foregroundColor: color ?? AppTheme.textDark,
        side: BorderSide(color: color ?? AppTheme.strokeGrey, width: borderWidth),
        minimumSize: const Size(0, 40),
        padding: const EdgeInsets.symmetric(horizontal: 12),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppTheme.radiusControl),
        ),
        textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
      );

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      spacing: 10,
      children: [
          if (onSuspend != null)
            OutlinedButton.icon(
              onPressed: () => _confirmSuspend(context),
              icon: const Icon(Icons.pause_circle_outline, size: 18),
              label: const Text('Приостановить'),
              // Янтарный #FF9500 ушёл: в каноне такого оттенка нет, и
              // проверено — в макете редизайна он не встречается ни разу.
              // Приостановка — действие с последствиями, её место в
              // предупреждающем красном канона.
              style: _action(color: AppTheme.errorRed, borderWidth: 1.5),
            ),
          if (onUnsuspend != null)
            FilledButton.icon(
              onPressed: () => _confirmUnsuspend(context),
              icon: const Icon(Icons.play_circle_outline, size: 18),
              label: const Text('Возобновить'),
              // Салатовый #3FD00D тоже вне канона. Возобновление — обычное
              // положительное действие, его цвет — брендовый.
              style: FilledButton.styleFrom(
                backgroundColor: AppTheme.primaryOrange,
                foregroundColor: AppTheme.textOnPrimary,
                elevation: 0,
                minimumSize: const Size(0, 40),
                padding: const EdgeInsets.symmetric(horizontal: 12),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppTheme.radiusControl),
                ),
                textStyle:
                    const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
              ),
            ),
          if (onClaim != null)
            OutlinedButton.icon(
              onPressed: () => _showClaimDialog(context),
              icon: const Icon(
                Icons.person_add_outlined,
                size: 18,
                color: AppTheme.textSecondary,
              ),
              label: const Text('Назначить партнёра'),
              style: _action(),
            ),
      ],
    );
  }

  Future<void> _confirmSuspend(BuildContext context) async {
    final reason = await showDialog<String>(
      context: context,
      builder: (_) => const _SuspendReasonDialog(),
    );

    if (reason == null) return; // закрыли, не подтвердив
    onSuspend?.call(reason);
  }

  void _confirmUnsuspend(BuildContext context) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Возобновить заведение?'),
        content: const Text(
          'Заведение снова появится в поиске и каталоге.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.pop(ctx);
              onUnsuspend?.call();
            },
            style: FilledButton.styleFrom(
              backgroundColor: AppTheme.primaryOrange,
            ),
            child: const Text('Возобновить'),
          ),
        ],
      ),
    );
  }

  void _showClaimDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (ctx) => _ClaimUserSearchDialog(
        establishmentName: establishmentName,
        onUserSelected: (userId) {
          Navigator.pop(ctx);
          onClaim?.call(userId);
        },
      ),
    );
  }
}

// =============================================================================
// Claim User Search Dialog
// =============================================================================

class _ClaimUserSearchDialog extends StatefulWidget {
  final String establishmentName;
  final ValueChanged<String> onUserSelected;

  const _ClaimUserSearchDialog({
    required this.establishmentName,
    required this.onUserSelected,
  });

  @override
  State<_ClaimUserSearchDialog> createState() => _ClaimUserSearchDialogState();
}

class _ClaimUserSearchDialogState extends State<_ClaimUserSearchDialog> {
  final _searchController = TextEditingController();
  final _service = ModerationService();
  List<UserSearchResult> _results = [];
  bool _isLoading = false;
  String? _error;
  String? _selectedUserId;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _search(String query) async {
    if (query.trim().length < 2) {
      setState(() {
        _results = [];
        _error = null;
      });
      return;
    }

    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final results = await _service.searchUsers(query);
      setState(() {
        _results = results;
        _isLoading = false;
        _selectedUserId = null;
      });
    } catch (e) {
      setState(() {
        _isLoading = false;
        _error = 'Ошибка поиска';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Назначить партнёра'),
      content: SizedBox(
        width: 420,
        height: 400,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Заведение «${widget.establishmentName}» будет передано выбранному пользователю.',
              style: const TextStyle(fontSize: 13, color: Colors.grey),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _searchController,
              decoration: const InputDecoration(
                hintText: 'Поиск по email или имени...',
                prefixIcon: Icon(Icons.search),
                border: OutlineInputBorder(),
              ),
              onChanged: _search,
            ),
            const SizedBox(height: 12),
            Expanded(
              child: _buildResultsList(),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Отмена'),
        ),
        FilledButton(
          onPressed: _selectedUserId != null
              ? () => widget.onUserSelected(_selectedUserId!)
              : null,
          style: FilledButton.styleFrom(
            backgroundColor: const Color(0xFFF06B32),
          ),
          child: const Text('Назначить'),
        ),
      ],
    );
  }

  Widget _buildResultsList() {
    if (_isLoading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_error != null) {
      return Center(
        child: Text(_error!, style: const TextStyle(color: Colors.red)),
      );
    }

    if (_searchController.text.trim().length < 2) {
      return const Center(
        child: Text(
          'Введите минимум 2 символа для поиска',
          style: TextStyle(color: Colors.grey),
        ),
      );
    }

    if (_results.isEmpty) {
      return const Center(
        child: Text(
          'Пользователи не найдены',
          style: TextStyle(color: Colors.grey),
        ),
      );
    }

    return ListView.builder(
      itemCount: _results.length,
      itemBuilder: (context, index) {
        final user = _results[index];
        final isSelected = _selectedUserId == user.id;

        return ListTile(
          selected: isSelected,
          selectedTileColor: const Color(0xFFF06B32).withValues(alpha: 0.1),
          leading: CircleAvatar(
            backgroundColor: user.role == 'partner'
                ? const Color(0xFFF06B32)
                : Colors.grey.shade400,
            child: Text(
              user.name.isNotEmpty ? user.name[0].toUpperCase() : '?',
              style: const TextStyle(color: Colors.white),
            ),
          ),
          title: Text(user.name),
          subtitle: Text('${user.email} · ${user.role}'),
          onTap: () => setState(() => _selectedUserId = user.id),
        );
      },
    );
  }
}

// =============================================================================
// Rejection Notes Header
// =============================================================================

/// Шапка панели в режиме чтения — кадры 11 и 13.
///
/// Имя крупным дисплейным, под ним строка состояния: точка статуса, статус
/// словом, город и укороченный идентификатор моноширинным. Id здесь не
/// украшение — это единственное место, где модератор может его взять, когда
/// нужно сослаться на карточку в переписке или в журнале.
class _PanelHeader extends StatelessWidget {
  final EstablishmentDetail detail;

  const _PanelHeader({required this.detail});

  @override
  Widget build(BuildContext context) {
    final segments = <Widget>[
      Text(
        StatusDot.labelFor(detail.status),
        style: const TextStyle(fontSize: 14, color: AppTheme.textSecondary),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      if (detail.city != null)
        Text(
          detail.city!,
          style: const TextStyle(fontSize: 14, color: AppTheme.textSecondary),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
      Text(
        detail.id.split('-').first,
        style: AppTheme.mono(fontSize: 12, color: AppTheme.textGrey),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
    ];

    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 24, 24, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            detail.name,
            style: AppTheme.unbounded(fontSize: 30, height: 1.1),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              StatusDot(detail.status),
              const SizedBox(width: 8),
              for (var i = 0; i < segments.length; i++) ...<Widget>[
                if (i > 0) ...<Widget>[
                  const SizedBox(width: 8),
                  const Text('·', style: TextStyle(color: AppTheme.textGrey)),
                  const SizedBox(width: 8),
                ],
                Flexible(child: segments[i]),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

/// Причины отказа — кадр 12.
///
/// Белая карточка с красноватой рамкой и тенью: отказ это **событие**, у него
/// есть время, и выглядеть оно должно как отдельная запись поверх карточки.
/// Причину приостановки рисует [_SuspensionBlock] — плоской заливкой, потому
/// что это, наоборот, длящееся состояние.
///
/// Сюда переехали комментарии, которые раньше показывались прямо в строках
/// полей: в режиме чтения строки заменены сеткой значений, и место для
/// причины осталось только здесь. Сведения не потерялись — они собрались.
class _RejectionNotesBlock extends StatelessWidget {
  final Map<String, dynamic> notes;

  const _RejectionNotesBlock({required this.notes});

  @override
  Widget build(BuildContext context) {
    final entries = notes.entries
        .where((e) => e.value != null && e.value.toString().trim().isNotEmpty)
        .toList();
    if (entries.isEmpty) return const SizedBox.shrink();

    return Container(
      margin: const EdgeInsets.fromLTRB(24, 18, 24, 0),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppTheme.backgroundPrimary,
        border: Border.all(color: AppTheme.errorRed.withValues(alpha: .35)),
        borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
        boxShadow: AppTheme.cardShadow,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              const Icon(
                Icons.flag_outlined,
                size: 18,
                color: AppTheme.errorRed,
              ),
              const SizedBox(width: 8),
              const Text(
                'Причины отказа',
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                  color: AppTheme.textPrimary,
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: AppTheme.errorRed.withValues(alpha: .10),
                  borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
                ),
                child: Text(
                  countWithNoun(entries.length, 'поле', 'поля', 'полей'),
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: AppTheme.errorRed,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          for (final entry in entries)
            Container(
              padding: const EdgeInsets.symmetric(vertical: 9),
              decoration: const BoxDecoration(
                border: Border(top: BorderSide(color: AppTheme.borderLight)),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 120,
                    child: Text(
                      _fieldLabel(entry.key),
                      style: const TextStyle(
                        fontSize: 13,
                        color: AppTheme.textSecondary,
                      ),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Text(
                      entry.value.toString(),
                      style: const TextStyle(
                        fontSize: 13,
                        color: AppTheme.textDark,
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  String _fieldLabel(String key) {
    const labels = {
      'legal_name': 'Полное название',
      'unp': 'УНП',
      'registration_doc': 'Регистрация',
      'contact_person': 'Контактное лицо',
      'contact_email': 'E-mail',
      'description': 'Описание',
      'name': 'Название',
      'customer_phone': 'Номер для связи',
      'website': 'Сайт',
      'working_hours': 'Время работы',
      'price_range': 'Средний чек',
      'photos': 'Фото',
      'menu': 'Меню',
      'address': 'Адрес',
    };
    return labels[key] ?? key;
  }
}

/// Причина приостановки — кадр 13.
///
/// Плоская заливка disclaimer-парой, без рамки и тени: приостановка это
/// состояние, в котором заведение находится сейчас, а не событие поверх
/// карточки. Отсюда и разница с [_RejectionNotesBlock].
///
/// Имя модератора приходит из журнала действий (`suspended_by` в проекции
/// карточки), а не из `moderation_notes`: туда при приостановке пишутся
/// только причина и время. Приостановка старше журнала автора не имеет —
/// тогда показывается одно время, выдуманного имени не будет.
class _SuspensionBlock extends StatelessWidget {
  final Map<String, dynamic>? notes;
  final String? authorName;

  const _SuspensionBlock({required this.notes, this.authorName});

  @override
  Widget build(BuildContext context) {
    final reason = notes?['suspend_reason']?.toString().trim();
    if (reason == null || reason.isEmpty) return const SizedBox.shrink();
    final author = authorName?.trim();

    // `.toLocal()` обязателен: бэкенд пишет метку через toISOString(), то
    // есть в UTC, и чтение `.day`/`.hour` прямо с неё показало бы время на
    // три часа раньше — а всё, что приостановлено после 21:00, ещё и
    // вчерашним числом. В остальной админке это уже делается так же.
    final raw = notes?['suspended_at'];
    final stamp =
        raw == null ? null : DateTime.tryParse(raw.toString())?.toLocal();

    return Container(
      margin: const EdgeInsets.fromLTRB(24, 18, 24, 0),
      padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
      decoration: BoxDecoration(
        color: AppTheme.disclaimerBg,
        borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              const Icon(
                Icons.pause_circle_outline,
                size: 18,
                color: AppTheme.disclaimerText,
              ),
              const SizedBox(width: 8),
              const Text(
                'Причина приостановки',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: AppTheme.disclaimerText,
                ),
              ),
              const Spacer(),
              if (stamp != null)
                Text(
                  _formatStamp(stamp),
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppTheme.disclaimerText,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            reason,
            style: const TextStyle(
              fontSize: 15,
              color: AppTheme.textDark,
              height: 1.5,
            ),
          ),
          if (author != null && author.isNotEmpty) ...<Widget>[
            const SizedBox(height: 8),
            Text(
              'Приостановил: $author',
              style: const TextStyle(
                fontSize: 13,
                color: AppTheme.disclaimerText,
              ),
            ),
          ],
        ],
      ),
    );
  }

  static String _formatStamp(DateTime value) {
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(value.day)}.${two(value.month)}.${value.year}, '
        '${two(value.hour)}:${two(value.minute)}';
  }
}

// =============================================================================
// Tab 1: Данные
// =============================================================================

class _DataTab extends StatelessWidget {
  final EstablishmentDetail detail;
  final bool isReadOnly;

  const _DataTab({
    required this.detail,
    this.isReadOnly = false,
  });

  @override
  Widget build(BuildContext context) {
    if (isReadOnly) return _readOnly();

    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      children: [
        ModerationFieldReview(
          fieldName: 'legal_name',
          label: 'Полное название заведения',
          isRequired: true,
          child: _FieldValue(detail.legalName ?? detail.name),
        ),
        ModerationFieldReview(
          fieldName: 'unp',
          label: 'УНП',
          isRequired: true,
          child: _FieldValue(detail.unp),
        ),
        ModerationFieldReview(
          fieldName: 'registration_doc',
          label: 'Регистрация',
          isRequired: true,
          child: detail.registrationDocUrl != null &&
                  detail.registrationDocUrl!.isNotEmpty
              ? _FileLink(detail.registrationDocUrl!)
              : const _FieldValue(null),
        ),
        ModerationFieldReview(
          fieldName: 'contact_person',
          label: 'Номер контактного лица',
          isRequired: true,
          child: _FieldValue(detail.contactPerson ?? detail.phone),
        ),
        ModerationFieldReview(
          fieldName: 'contact_email',
          label: 'E-mail',
          isRequired: true,
          child: _FieldValue(detail.contactEmail ?? detail.email),
        ),
      ],
    );
  }
}

// =============================================================================
// Tab 2: О заведении
// =============================================================================

/// Режим чтения вкладки «Данные» — по кадру 11.
///
/// Состав отличается от режима модерации намеренно, и это не расхождение
/// макета: под модерацией «Данные» означают юридические сведения, которые
/// проверяют, а у одобренного заведения — сведения о карточке, которые
/// читают. Поэтому сюда стянуто то, что модерация раскладывает по двум
/// вкладкам.
///
/// Ячейки «Партнёр» из макета здесь нет: проекция детали отдаёт только
/// `partner_id`, а показывать UUID на экране модератора — тот самый дефект,
/// ради которого заводится русификация машинных обозначений. Понадобится —
/// добавлять join к `users` в проекцию, это отдельная работа.
extension _DataTabReadOnly on _DataTab {
  Widget _readOnly() => DefinitionGrid(
        items: <Definition>[
          Definition(label: 'Название', value: detail.name),
          Definition(
            label: 'Категории',
            value: detail.categories.join(', '),
          ),
          Definition(label: 'Кухни', value: detail.cuisines.join(', ')),
          Definition(label: 'Ценовой диапазон', value: detail.priceRange),
          Definition(label: 'Телефон', value: detail.phone),
          Definition(
            label: 'E-mail',
            value: detail.email ?? _partnerField(detail, detail.contactEmail),
          ),
          Definition(label: 'Сайт', value: detail.website),
          Definition(label: 'УНП', value: detail.unp, mono: true),
          Definition(
            label: 'Юридическое название',
            value: detail.legalName,
          ),
          Definition(
            label: 'Регистрация',
            child: !detail.partnerDataRedacted &&
                    detail.registrationDocUrl != null &&
                    detail.registrationDocUrl!.isNotEmpty
                ? _FileLink(detail.registrationDocUrl!)
                : null,
            value: _partnerField(detail, detail.registrationDocUrl),
          ),
        ],
      );
}

/// Контакты партнёра и документ: у просмотрщика сервер их не отдаёт, и
/// ячейка обязана сказать об этом словом, а не пустотой.
String? _partnerField(EstablishmentDetail detail, String? value) =>
    detail.partnerDataRedacted ? kRedactedForViewerLabel : value;

class _AboutTab extends StatelessWidget {
  final EstablishmentDetail detail;
  final bool isReadOnly;

  const _AboutTab({
    required this.detail,
    this.isReadOnly = false,
  });

  @override
  Widget build(BuildContext context) {
    if (isReadOnly) return _readOnlyAbout();

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Moderable fields
        ModerationFieldReview(
          fieldName: 'description',
          label: 'Описание',
          isRequired: true,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _FieldValue(detail.description),
              if (detail.description != null)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    '${detail.description!.length}/450',
                    style: const TextStyle(
                      fontSize: 13,
                      color: Color(0xFFABABAB),
                    ),
                  ),
                ),
            ],
          ),
        ),
        ModerationFieldReview(
          fieldName: 'name',
          label: 'Название',
          isRequired: true,
          child: _FieldValue(detail.name),
        ),
        ModerationFieldReview(
          fieldName: 'customer_phone',
          label: 'Номер для связи с клиентом',
          isRequired: true,
          child: _FieldValue(detail.phone),
        ),
        ModerationFieldReview(
          fieldName: 'website',
          label: 'Ссылка на соц. сеть/сайт',
          child: _FieldValue(detail.website),
        ),
        ModerationFieldReview(
          fieldName: 'working_hours',
          label: 'Время работы',
          isRequired: true,
          child: _WorkingHoursDisplay(detail.workingHours),
        ),
        ModerationFieldReview(
          fieldName: 'price_range',
          label: 'Средний чек',
          isRequired: true,
          child: _FieldValue(detail.priceRange),
        ),

        // Informational fields (no approve/reject buttons)
        const SizedBox(height: 16),
        const Divider(),
        const Padding(
          padding: EdgeInsets.symmetric(vertical: 8),
          child: Text(
            'Информационные поля',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w500,
              color: Color(0xFFABABAB),
            ),
          ),
        ),
        _InfoField(
          label: 'Время дополнительного меню',
          child: _WorkingHoursDisplay(detail.specialHours),
        ),
        _InfoField(
          label: 'Атрибуты заведения',
          child: _AttributesDisplay(detail.attributes),
        ),
      ],
    );
  }
}

// =============================================================================
// Tab 3: Медиа
// =============================================================================

/// Режим чтения вкладки «О заведении»: проза, расписание и удобства.
///
/// Все три занимают строку целиком — это не пары «подпись/значение», а блоки,
/// которым узкая колонка вредит.
extension _AboutTabReadOnly on _AboutTab {
  Widget _readOnlyAbout() => DefinitionGrid(
        items: <Definition>[
          Definition(
            label: 'Описание',
            value: detail.description,
            wide: true,
          ),
          Definition(
            label: 'Часы работы',
            wide: true,
            child: _WorkingHoursDisplay(detail.workingHours),
          ),
          Definition(
            label: 'Удобства',
            wide: true,
            child: _AttributesDisplay(detail.attributes),
          ),
          Definition(
            label: 'Время дополнительного меню',
            value: _specialHoursSummary(detail.specialHours),
            wide: true,
          ),
          Definition(
            label: 'Номер контактного лица',
            value: _partnerField(detail, detail.contactPerson),
          ),
          Definition(label: 'Ценовой диапазон', value: detail.priceRange),
        ],
      );
}

/// Особые часы одной строкой: «завтрак 08:00–11:00 · бизнес-ланч 12:00–16:00».
///
/// В режиме модерации их показывает отдельная строка поля; в чтении они
/// сжимаются в одну ячейку — иначе на экране, где решать нечего, расписание
/// занимало бы места больше, чем заслуживает.
String? _specialHoursSummary(Map<String, dynamic>? hours) {
  if (hours == null || hours.isEmpty) return null;

  final parts = <String>[];
  for (final entry in hours.entries) {
    final value = entry.value;
    if (value is Map && value['start'] != null && value['end'] != null) {
      parts.add('${entry.key} ${value['start']}–${value['end']}');
    } else if (value != null && value.toString().trim().isNotEmpty) {
      parts.add('${entry.key} $value');
    }
  }
  return parts.isEmpty ? null : parts.join(' · ');
}

class _MediaTab extends StatelessWidget {
  final EstablishmentDetail detail;
  final bool isReadOnly;

  const _MediaTab({
    required this.detail,
    this.isReadOnly = false,
  });

  @override
  Widget build(BuildContext context) {
    if (isReadOnly) return _readOnlyMedia();

    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      children: [
        ModerationFieldReview(
          fieldName: 'photos',
          label: 'Фото',
          isRequired: true,
          child: detail.interiorPhotos.isNotEmpty
              ? _PhotoGrid(photos: detail.interiorPhotos, title: 'Фото')
              : const Text(
                  'Фотографии не загружены',
                  style: TextStyle(color: Color(0xFFABABAB)),
                ),
        ),
        ModerationFieldReview(
          fieldName: 'menu',
          label: 'Меню',
          isRequired: true,
          child: detail.menuMedia.isNotEmpty
              ? _PhotoGrid(photos: detail.menuMedia, title: 'Меню')
              : const Text(
                  'Меню не загружено',
                  style: TextStyle(color: Color(0xFFABABAB)),
                ),
        ),
      ],
    );
  }
}

// =============================================================================
// Tab 4: Адрес
// =============================================================================

/// Режим чтения вкладки «Медиа»: галереи без обёрток вердикта.
///
/// Сетку определений сюда не применяем — снимки не пара «подпись/значение»,
/// и разложить их по двум колонкам значило бы уменьшить вдвое.
extension _MediaTabReadOnly on _MediaTab {
  Widget _readOnlyMedia() {
    final hasPhotos = detail.interiorPhotos.isNotEmpty;
    final hasMenu = detail.menuMedia.isNotEmpty;

    return ListView(
      padding: DefinitionGrid.padding,
      children: <Widget>[
        const Text('Фото', style: AppTheme.canonFieldLabel),
        const SizedBox(height: 8),
        if (hasPhotos)
          _PhotoGrid(photos: detail.interiorPhotos, title: 'Фото')
        else
          const Text('не загружено', style: AppTheme.canonFieldValueEmpty),
        const SizedBox(height: 20),
        const Text('Меню', style: AppTheme.canonFieldLabel),
        const SizedBox(height: 8),
        if (hasMenu)
          _PhotoGrid(photos: detail.menuMedia, title: 'Меню')
        else
          const Text('не загружено', style: AppTheme.canonFieldValueEmpty),
      ],
    );
  }
}

class _AddressTab extends StatelessWidget {
  final EstablishmentDetail detail;
  final bool isReadOnly;
  final void Function(double latitude, double longitude)? onUpdateCoordinates;

  const _AddressTab({
    required this.detail,
    this.isReadOnly = false,
    this.onUpdateCoordinates,
  });

  @override
  Widget build(BuildContext context) {
    final addressParts = [
      if (detail.city != null) detail.city!,
      if (detail.address != null) detail.address!,
    ];

    if (isReadOnly) return _readOnlyAddress();

    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      children: [
        ModerationFieldReview(
          fieldName: 'address',
          label: 'Адрес',
          isRequired: true,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _FieldValue(addressParts.isNotEmpty
                  ? addressParts.join(', ')
                  : null),
              if (detail.latitude != null && detail.longitude != null) ...[
                const SizedBox(height: 12),
                _MapPreview(
                  latitude: detail.latitude!,
                  longitude: detail.longitude!,
                  onUpdateCoordinates: onUpdateCoordinates,
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

// =============================================================================
// Map Preview — coordinates + "Open in Yandex Maps" button
// =============================================================================

/// Режим чтения вкладки «Адрес».
///
/// Координаты моноширинным — это величина, а не проза; карта занимает строку
/// целиком. Правка координат здесь недоступна: у одобренного заведения
/// адрес уже принят, и менять его мимо модерации нельзя.
extension _AddressTabReadOnly on _AddressTab {
  Widget _readOnlyAddress() {
    final lat = detail.latitude;
    final lon = detail.longitude;

    return DefinitionGrid(
      items: <Definition>[
        Definition(label: 'Город', value: detail.city),
        Definition(label: 'Адрес', value: detail.address),
        if (lat != null && lon != null)
          Definition(
            label: 'Координаты',
            value: '${lat.toStringAsFixed(6)}, ${lon.toStringAsFixed(6)}',
            mono: true,
          ),
        if (lat != null && lon != null)
          Definition(
            label: 'На карте',
            wide: true,
            child: _MapPreview(latitude: lat, longitude: lon),
          ),
      ],
    );
  }
}

class _MapPreview extends StatelessWidget {
  final double latitude;
  final double longitude;
  final void Function(double latitude, double longitude)? onUpdateCoordinates;

  const _MapPreview({
    required this.latitude,
    required this.longitude,
    this.onUpdateCoordinates,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFFF5F5F5),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0xFFD2D2D2)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Coordinates
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(
                Icons.location_on,
                size: 20,
                color: Color(0xFFDB4F13),
              ),
              const SizedBox(width: 8),
              Text(
                '${latitude.toStringAsFixed(6)}, ${longitude.toStringAsFixed(6)}',
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w500,
                  color: Color(0xFF333333),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          // Open in Yandex Maps button
          SizedBox(
            height: 40,
            child: OutlinedButton.icon(
              onPressed: _openInYandexMaps,
              icon: const Icon(Icons.open_in_new, size: 16),
              label: const Text('Открыть в Яндекс Картах'),
              style: OutlinedButton.styleFrom(
                foregroundColor: const Color(0xFFDB4F13),
                side: const BorderSide(color: Color(0xFFDB4F13)),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
            ),
          ),
          // Correct coordinates button
          if (onUpdateCoordinates != null) ...[
            const SizedBox(height: 8),
            SizedBox(
              height: 40,
              child: ElevatedButton.icon(
                onPressed: () => _showCoordinateDialog(context),
                icon: const Icon(Icons.edit_location_alt, size: 16),
                label: const Text('Исправить координаты'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFDB4F13),
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  void _openInYandexMaps() {
    final url = 'https://yandex.ru/maps/?pt=$longitude,$latitude&z=16&l=map';
    openInNewTab(url);
  }

  void _showCoordinateDialog(BuildContext context) {
    final latController = TextEditingController(text: latitude.toStringAsFixed(6));
    final lonController = TextEditingController(text: longitude.toStringAsFixed(6));

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Исправить координаты'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: latController,
              decoration: const InputDecoration(
                labelText: 'Широта (latitude)',
                hintText: '53.900000',
              ),
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: lonController,
              decoration: const InputDecoration(
                labelText: 'Долгота (longitude)',
                hintText: '27.550000',
              ),
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Отмена'),
          ),
          ElevatedButton(
            onPressed: () {
              final lat = double.tryParse(latController.text);
              final lon = double.tryParse(lonController.text);
              if (lat != null && lon != null) {
                Navigator.pop(ctx);
                onUpdateCoordinates?.call(lat, lon);
              }
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFDB4F13),
              foregroundColor: Colors.white,
            ),
            child: const Text('Сохранить'),
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// Action Bar (Approve / Reject buttons) — moderation mode only
// =============================================================================

class _ActionBar extends StatelessWidget {
  final ModerationProvider provider;
  const _ActionBar({required this.provider});

  @override
  Widget build(BuildContext context) {
    final error = provider.submitError;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppTheme.borderLight)),
      ),
      child: Row(
        children: [
          // Ход отправки показывается слева, а не внутри кнопки. Причина не
          // косметическая: `isSubmitting` общий для обоих действий, и спиннер
          // на кнопке одобрения загорался бы при отказе — то есть сообщал бы
          // о противоположном действии. К тому же при отклонённом поле эта
          // кнопка заблокирована и залита `strokeGrey`, на котором белый
          // спиннер не виден вовсе, и отказ оставался бы вообще без отклика.
          Expanded(
            child: provider.isSubmitting
                ? const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      AdminInlineSpinner(),
                      SizedBox(width: 8),
                      Text(
                        'Сохраняем решение…',
                        style: TextStyle(
                          fontSize: 13,
                          color: AppTheme.textSecondary,
                        ),
                      ),
                    ],
                  )
                : error != null
                    ? Text(
                        error,
                        style: const TextStyle(
                          fontSize: 13,
                          color: AppTheme.errorRed,
                        ),
                      )
                    : _StateHint(provider: provider),
          ),
          const SizedBox(width: 14),
          OutlinedButton(
            onPressed:
                provider.isSubmitting ? null : () => _confirmReject(context),
            style: AppTheme.canonCtaOutlined(color: AppTheme.errorRed),
            child: const Text('Отклонить заявку'),
          ),
          const SizedBox(width: 14),
          // Причина блокировки объясняется слева, а не внутри кнопки:
          // заблокированная кнопка без объяснения читается как поломка.
          ElevatedButton(
            onPressed: provider.isSubmitting || !provider.canApprove
                ? null
                : () => _confirmApprove(context),
            style: AppTheme.canonCtaL(),
            child: const Text('Одобрить заведение'),
          ),
        ],
      ),
    );
  }

  void _confirmApprove(BuildContext context) {
    // Провайдер берём ДО показа диалога: после await обращаться к
    // context нельзя, а счётчики очередей обновить надо.
    final badges = context.read<BadgesProvider>();

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Одобрить заведение?'),
        content: const Text(
          'Заведение будет опубликовано и станет видимым в поиске.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.pop(ctx);
              provider.approveEstablishment().then((ok) {
                // Очередь стала короче — бейдж в рейле обязан это
                // показать сразу, иначе действие выглядит несработавшим.
                if (ok) badges.load();
              });
            },
            style: FilledButton.styleFrom(
              backgroundColor: AppTheme.primaryOrange,
            ),
            child: const Text('Одобрить'),
          ),
        ],
      ),
    );
  }

  void _confirmReject(BuildContext context) {
    // Провайдер берём ДО показа диалога: после await обращаться к
    // context нельзя, а счётчики очередей обновить надо.
    final badges = context.read<BadgesProvider>();

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Отклонить заведение?'),
        content: const Text(
          'Заведение вернётся в черновик. Партнёр сможет исправить и отправить повторно.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.pop(ctx);
              provider.rejectEstablishment().then((ok) {
                // Очередь стала короче — бейдж в рейле обязан это
                // показать сразу, иначе действие выглядит несработавшим.
                if (ok) badges.load();
              });
            },
            style: FilledButton.styleFrom(
              backgroundColor: AppTheme.errorRed,
            ),
            child: const Text('Отклонить'),
          ),
        ],
      ),
    );
  }
}

/// Пояснение слева в нижней панели: почему кнопки выглядят именно так и
/// сколько работы осталось.
///
/// Заблокированная кнопка обязана иметь объяснение рядом — иначе модератор
/// читает её как поломку интерфейса, а не как следствие своего же вердикта.
class _StateHint extends StatelessWidget {
  final ModerationProvider provider;

  const _StateHint({required this.provider});

  @override
  Widget build(BuildContext context) {
    final rejected = provider.rejectedFieldCount;
    final remaining = provider.remainingFieldCount;
    final spans = <InlineSpan>[];

    if (rejected > 0) {
      spans.add(
        TextSpan(
          text: rejected == 1
              ? 'Одно поле отклонено — доступен только отказ.'
              : '${countWithNoun(rejected, 'поле', 'поля', 'полей')} '
                  'отклонено — доступен только отказ.',
        ),
      );
    }

    if (remaining > 0) {
      if (spans.isNotEmpty) spans.add(const TextSpan(text: ' '));
      spans.add(const TextSpan(text: 'Осталось проверить '));
      spans.add(
        TextSpan(
          text: countWithNoun(remaining, 'поле', 'поля', 'полей'),
          style: const TextStyle(
            fontWeight: FontWeight.w600,
            color: AppTheme.textDark,
          ),
        ),
      );
      spans.add(const TextSpan(text: '.'));
    } else if (spans.isEmpty) {
      spans.add(const TextSpan(text: 'Все поля проверены.'));
    }

    return Text.rich(
      TextSpan(
        style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary),
        children: spans,
      ),
    );
  }
}

// =============================================================================
// Shared helper widgets
// =============================================================================

/// Displays a single field value in a bordered container (matching Figma input style)
class _FieldValue extends StatelessWidget {
  final String? value;
  const _FieldValue(this.value);

  @override
  Widget build(BuildContext context) {
    final empty = value == null || value!.isEmpty;

    // Ни рамки, ни подложки: рамка означает поле ввода, а это значение для
    // чтения. Пустое называется словом, а не прочерком.
    return Text(
      empty ? 'не указан' : value!,
      style: empty ? AppTheme.canonFieldValueEmpty : AppTheme.canonFieldValue,
    );
  }
}

/// Displays a file link / PDF reference
class _FileLink extends StatelessWidget {
  final String url;
  const _FileLink(this.url);

  @override
  Widget build(BuildContext context) {
    final fileName = Uri.tryParse(url)?.pathSegments.lastOrNull ?? url;

    return InkWell(
      onTap: () => openInNewTab(url),
      borderRadius: BorderRadius.circular(AppTheme.radiusXSmall),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        spacing: 8,
        children: [
          const Icon(Icons.description, size: 17, color: AppTheme.primaryOrange),
          Flexible(
            child: Text(
              fileName,
              style: AppTheme.canonFieldValue,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

/// Displays working hours in a readable table: day name → time range or "Закрыто"
class _WorkingHoursDisplay extends StatelessWidget {
  final Map<String, dynamic>? hours;
  const _WorkingHoursDisplay(this.hours);

  static const _dayOrder = [
    'monday', 'tuesday', 'wednesday', 'thursday',
    'friday', 'saturday', 'sunday',
  ];

  static const _dayNames = {
    'monday': 'Понедельник',
    'tuesday': 'Вторник',
    'wednesday': 'Среда',
    'thursday': 'Четверг',
    'friday': 'Пятница',
    'saturday': 'Суббота',
    'sunday': 'Воскресенье',
  };

  @override
  Widget build(BuildContext context) {
    if (hours == null || hours!.isEmpty) {
      return const _FieldValue(null);
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: const Color(0xFFD2D2D2), width: 1.13),
        borderRadius: BorderRadius.circular(11),
      ),
      child: Column(
        children: _dayOrder.map((dayKey) {
          final dayData = hours![dayKey];
          final dayName = _dayNames[dayKey] ?? dayKey;
          final isOpen = dayData is Map && dayData['is_open'] == true;
          final open = dayData is Map ? dayData['open'] as String? : null;
          final close = dayData is Map ? dayData['close'] as String? : null;

          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 3),
            child: Row(
              children: [
                SizedBox(
                  width: 120,
                  child: Text(
                    dayName,
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                      color: isOpen
                          ? Colors.black
                          : const Color(0xFFABABAB),
                    ),
                  ),
                ),
                Expanded(
                  child: Text(
                    isOpen && open != null && close != null
                        ? '$open – $close'
                        : 'Закрыто',
                    style: TextStyle(
                      fontSize: 14,
                      color: isOpen
                          ? Colors.black
                          : const Color(0xFFABABAB),
                    ),
                  ),
                ),
              ],
            ),
          );
        }).toList(),
      ),
    );
  }
}

/// Displays attributes as tags/chips
class _AttributesDisplay extends StatelessWidget {
  final Map<String, dynamic>? attributes;
  const _AttributesDisplay(this.attributes);

  @override
  Widget build(BuildContext context) {
    if (attributes == null || attributes!.isEmpty) {
      return const _FieldValue(null);
    }

    return Wrap(
      spacing: 8,
      runSpacing: 4,
      children: attributes!.entries.map((entry) {
        final isActive = entry.value == true;
        return Chip(
          label: Text(
            entry.key,
            style: TextStyle(
              fontSize: 13,
              color: isActive ? Colors.black : const Color(0xFFABABAB),
            ),
          ),
          backgroundColor: isActive
              ? const Color(0x1A3FD00D)
              : const Color(0xFFF5F5F5),
          side: BorderSide.none,
          visualDensity: VisualDensity.compact,
        );
      }).toList(),
    );
  }
}

/// Сетка медиа во вкладке «Медиа».
///
/// Каждая плитка открывает полноэкранный просмотр с увеличением. Без него
/// модерация медиа не работает: на 120×90 снимок не разглядеть, а меню —
/// это текст, который на таком размере просто не читается.
class _PhotoGrid extends StatelessWidget {
  final List<MediaItem> photos;

  /// Что за набор — «Фото» или «Меню». Показывается в шапке просмотрщика.
  final String title;

  const _PhotoGrid({required this.photos, required this.title});

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (var i = 0; i < photos.length; i++)
          _PhotoTile(
            item: photos[i],
            onOpen: () => showMediaViewer(
              context,
              items: photos,
              title: title,
              initialIndex: i,
            ),
          ),
      ],
    );
  }
}

/// Плитка с подсказкой при наведении — иначе о возможности увеличить никто
/// не догадается: раньше её просто не было.
class _PhotoTile extends StatefulWidget {
  final MediaItem item;
  final VoidCallback onOpen;

  const _PhotoTile({required this.item, required this.onOpen});

  @override
  State<_PhotoTile> createState() => _PhotoTileState();
}

class _PhotoTileState extends State<_PhotoTile> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final item = widget.item;

    return MouseRegion(
      cursor: SystemMouseCursors.click,
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: GestureDetector(
        onTap: widget.onOpen,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
          child: SizedBox(
            width: 120,
            height: 90,
            child: Stack(
              fit: StackFit.expand,
              children: [
                Image.network(
                  item.thumbnailUrl ?? item.previewUrl ?? item.url,
                  fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => const ColoredBox(
                    color: AppTheme.gray100,
                    child: Icon(Icons.broken_image,
                        color: AppTheme.strokeGrey),
                  ),
                ),
                if (item.isPdf)
                  Positioned(
                    left: 6,
                    top: 6,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: AppTheme.disclaimerBg,
                        borderRadius:
                            BorderRadius.circular(AppTheme.radiusXSmall),
                      ),
                      child: const Text(
                        'PDF',
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                          color: AppTheme.disclaimerText,
                        ),
                      ),
                    ),
                  ),
                if (_hovered)
                  ColoredBox(
                    color: Colors.black.withValues(alpha: 0.35),
                    child: const Center(
                      child: Icon(Icons.zoom_in, color: Colors.white, size: 28),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Informational field (no approve/reject buttons)
class _InfoField extends StatelessWidget {
  final String label;
  final Widget child;
  const _InfoField({required this.label, required this.child});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w500,
              color: Color(0xFFABABAB),
            ),
          ),
          const SizedBox(height: 8),
          child,
        ],
      ),
    );
  }
}

/// Диалог приостановки — отдельным виджетом, потому что он владеет контроллером.
///
/// Две причины, обе проверены на близнеце этого диалога в отзывах.
///
/// **Контроллер.** Прежде он создавался в вызывающем методе и не освобождался
/// вовсе — последний такой случай в проекте. Пользователю это не видно
/// (слушатель у поля один, и он умирает вместе с диалогом), но правило
/// «создал — освободи» держится только целиком. Освобождать через
/// `showDialog(...).whenComplete(dispose)` при этом НЕЛЬЗЯ: future завершается
/// на попе маршрута, а тот ещё уезжает анимацией, и тронутое поле
/// перестраивается уже после `dispose`. `State.dispose` вызывается после
/// размонтирования — тогда, когда поля уже нет.
///
/// **Кнопка.** Прежде при пустой причине она выходила по `return`: выглядела
/// активной и молча не реагировала на нажатие. Это хуже заблокированной
/// кнопки, про которую канон говорит прямо — причина блокировки объясняется
/// рядом, иначе кнопка читается как поломка. Теперь состояние кнопки следует
/// за полем, а рядом написано, чего не хватает.
class _SuspendReasonDialog extends StatefulWidget {
  const _SuspendReasonDialog();

  @override
  State<_SuspendReasonDialog> createState() => _SuspendReasonDialogState();
}

class _SuspendReasonDialogState extends State<_SuspendReasonDialog> {
  final _reasonController = TextEditingController();

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Приостановить заведение?'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('Заведение будет скрыто из поиска и каталога.'),
          const SizedBox(height: 12),
          TextField(
            controller: _reasonController,
            maxLines: 3,
            autofocus: true,
            decoration: const InputDecoration(
              hintText: 'Причина приостановки...',
            ),
          ),
        ],
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Отмена'),
        ),
        // Значение поля читается через сам контроллер: он и есть источник
        // истины, а `setState` по каждому нажатию клавиши перерисовывал бы
        // диалог целиком ради одной кнопки.
        ValueListenableBuilder<TextEditingValue>(
          valueListenable: _reasonController,
          builder: (context, value, _) {
            final reason = value.text.trim();

            return Row(
              mainAxisSize: MainAxisSize.min,
              spacing: 10,
              children: <Widget>[
                if (reason.isEmpty)
                  const Text(
                    'Нужна причина',
                    style: TextStyle(
                      fontSize: 12,
                      color: AppTheme.textSecondary,
                    ),
                  ),
                FilledButton(
                  onPressed: reason.isEmpty
                      ? null
                      : () => Navigator.of(context).pop(reason),
                  style: FilledButton.styleFrom(
                    backgroundColor: AppTheme.errorRed,
                    disabledBackgroundColor: AppTheme.strokeGrey,
                    disabledForegroundColor: AppTheme.textSecondary,
                  ),
                  child: const Text('Приостановить'),
                ),
              ],
            );
          },
        ),
      ],
    );
  }
}
