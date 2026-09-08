import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/providers/moderation_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_screen_header.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_detail_panel.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_list_panel.dart';

/// Экран «Ожидают просмотра» — очередь заявок и разбор выбранной.
///
/// Шапка держит три вещи: состояние очереди (сколько ждёт и сколько ждёт
/// старейшая), прогресс проверки выбранной заявки и порядок сортировки.
/// Все три относятся к экрану целиком, поэтому живут в шапке, а не внутри
/// панелей — в панель опускается только то, что принадлежит ей одной.
class PendingModerationScreen extends StatefulWidget {
  const PendingModerationScreen({super.key});

  @override
  State<PendingModerationScreen> createState() =>
      _PendingModerationScreenState();
}

class _PendingModerationScreenState extends State<PendingModerationScreen> {
  @override
  void initState() {
    super.initState();
    // Load pending establishments after first frame
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<ModerationProvider>().loadPendingEstablishments();
    });
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<ModerationProvider>();
    // Просмотрщик видит очередь и карточки, но не выносит вердиктов: панель
    // разбора для него в режиме чтения, а прогресс проверки не рисуется —
    // считать ему нечего. Охрана действий при этом на сервере (403), здесь
    // только не обещаем того, что не выполнится.
    final canModerate = context.watch<AuthProvider>().canModerate;

    return Column(
      children: [
        AdminScreenHeader(
          title: 'Ожидают просмотра',
          subtitle: _queueSubtitle(provider),
          actions: <Widget>[
            // Прогресс показывается только при выбранной заявке: без неё
            // проверять нечего, и «0 из 14» было бы не состоянием, а шумом.
            if (canModerate && provider.selectedId != null)
              _FieldProgress(
                checked: provider.checkedFieldCount,
                total: provider.totalFieldCount,
                fraction: provider.checkedFraction,
              ),
            const _SortOrderLabel(),
          ],
        ),
        Expanded(
          child: Row(
            children: [
              const ModerationListPanel(),
              Expanded(
                child: ModerationDetailPanel(
                  mode: canModerate
                      ? DetailPanelMode.moderation
                      : DetailPanelMode.readonly,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  /// «7 заявок в очереди · старейшая ждёт 4 дня».
  ///
  /// Обе величины берутся из загруженного списка, а не из `oldest_pending_at`
  /// дашборда: тот считает возраст по `created_at`, а очередь здесь живёт по
  /// `updated_at`, и смешение двух отсчётов дало бы подпись, противоречащую
  /// бейджам под ней.
  String? _queueSubtitle(ModerationProvider provider) {
    if (provider.isLoadingList) return null;
    if (provider.listError != null) return null;

    final total = provider.totalCount;
    if (total == 0) return 'Очередь пуста';

    final queue = '${countWithNoun(total, 'заявка', 'заявки', 'заявок')} в очереди';
    final oldest = provider.oldestWaitingDays;
    if (oldest == null) return queue;
    // Не «пришла сегодня»: счёт идёт полными сутками, а не календарными
    // днями, и заявка от 22:00 вчерашнего дня в девять утра даёт ноль.
    if (oldest == 0) return '$queue · старейшая ждёт меньше суток';

    return '$queue · старейшая ждёт ${countWithNoun(oldest, 'день', 'дня', 'дней')}';
  }
}

/// Индикатор проверки полей в шапке экрана.
class _FieldProgress extends StatelessWidget {
  final int checked;
  final int total;
  final double fraction;

  const _FieldProgress({
    required this.checked,
    required this.total,
    required this.fraction,
  });

  static const double width = 190;

  @override
  Widget build(BuildContext context) {
    // Ширина фиксированная, а не «не меньше»: индикатор стоит в слоте шапки,
    // то есть внутри Row, который по главной оси даёт неограниченную ширину.
    // Column со stretch и Spacer в такой ширине не раскладываются вовсе —
    // под debug-ассертами это «BoxConstraints forces an infinite width»,
    // вскрытое тестом экрана целиком (viewer_gating_test).
    return SizedBox(
      width: width,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              const Text(
                'Проверено полей',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: AppTheme.textDark,
                ),
              ),
              const Spacer(),
              Text.rich(
                TextSpan(
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppTheme.textSecondary,
                  ),
                  children: <InlineSpan>[
                    TextSpan(
                      text: '$checked',
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        color: AppTheme.primaryOrangeDark,
                      ),
                    ),
                    TextSpan(text: ' из $total'),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(3),
            child: LinearProgressIndicator(
              value: fraction,
              minHeight: 5,
              backgroundColor: AppTheme.backgroundWarm,
              valueColor: const AlwaysStoppedAnimation<Color>(
                AppTheme.primaryOrange,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Порядок разбора очереди.
///
/// Подпись, а не выпадающий список: бэкенд отдаёт очередь единственным
/// порядком (`ORDER BY e.updated_at ASC`), и стрелка вниз обещала бы выбор,
/// которого нет. В макете стрелка нарисована — отступление сознательное и
/// ровно на одну иконку. Появится параметр сортировки в API — здесь встанет
/// настоящий контрол.
class _SortOrderLabel extends StatelessWidget {
  const _SortOrderLabel();

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 40,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        border: Border.all(color: AppTheme.strokeGrey),
        borderRadius: BorderRadius.circular(AppTheme.radiusControl),
      ),
      child: const Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.swap_vert, size: 17, color: AppTheme.textSecondary),
          SizedBox(width: 8),
          Text(
            'Сначала старые',
            style: TextStyle(fontSize: 14, color: AppTheme.textDark),
          ),
        ],
      ),
    );
  }
}
