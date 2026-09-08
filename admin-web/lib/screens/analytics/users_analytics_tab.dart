import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/analytics_vocabulary.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/analytics_models.dart';
import 'package:restaurant_guide_admin_web/providers/users_analytics_provider.dart';
import 'package:restaurant_guide_admin_web/screens/analytics/analytics_tab_scaffold.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/analytics_panel.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/canon_line_chart.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/metric_card.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/share_bar.dart';

/// Вкладка «Пользователи» — кадр 10.
///
/// Ряд данных здесь ровно один — регистрации, — и он получает всю оставшуюся
/// высоту. Распределение по ролям стоит под ним одной полосой во всю ширину:
/// трёх ролей на карточку в треть экрана не хватает, а пустая колонка рядом
/// выглядела бы как не загрузившаяся.
class UsersAnalyticsTab extends StatelessWidget {
  const UsersAnalyticsTab({super.key});

  /// Высота карточки ролей: рамка 1 + отступ 18 + заголовок 20 + зазор 14 +
  /// полоса 24 + зазор 14 + строка легенды 19 + отступ 18 + рамка 1.
  /// Задана явно, чтобы остаток окна доставался графику целиком — и потому
  /// обязана совпадать с настоящей: занизив её, мы отдаём графику пиксели,
  /// которых нет, и раздел начинает прокручиваться без причины.
  static const double _rolesHeight = 130;

  static const double _minChartHeight = 260;

  @override
  Widget build(BuildContext context) {
    return Consumer<UsersAnalyticsProvider>(
      builder: (context, provider, _) {
        return AnalyticsTabScaffold(
          isLoading: provider.isLoading,
          error: provider.error,
          hasData: provider.data != null,
          onRetry: provider.load,
          errorTitle: 'Статистика пользователей не загрузилась',
          // Скелетон повторяет ту же раскладку, что придёт: график растёт,
          // карточка ролей фиксирована.
          skeleton: const AnalyticsTabSkeleton(
            panelsHeight: _rolesHeight,
            panelsInRow: 1,
          ),
          builder: (context, restHeight) => _content(
            provider.data!,
            math.max(
              _minChartHeight,
              restHeight - _rolesHeight - AnalyticsTabScaffold.gap,
            ),
          ),
        );
      },
    );
  }

  Widget _content(UsersAnalyticsData data, double chartHeight) {
    final partners = data.roleCount('partner');
    final admins = data.roleCount('admin');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: AnalyticsTabScaffold.gap,
      children: <Widget>[
        SizedBox(
          height: AnalyticsTabScaffold.metricsHeight,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            spacing: AnalyticsTabScaffold.gap,
            children: <Widget>[
              Expanded(
                child: MetricCard(
                  icon: Icons.group_outlined,
                  label: 'Всего пользователей',
                  value: formatCount(data.total),
                ),
              ),
              Expanded(
                child: MetricCard(
                  icon: Icons.person_add_alt_outlined,
                  label: 'Новых за период',
                  value: formatCount(data.newInPeriod),
                  changePercent: data.changePercent,
                ),
              ),
              Expanded(
                child: MetricCard(
                  icon: Icons.storefront_outlined,
                  label: 'Партнёров',
                  value: formatCount(partners),
                  valueNote: '${formatShare(partners, data.total)} базы',
                ),
              ),
              Expanded(
                child: MetricCard(
                  icon: Icons.shield_outlined,
                  label: 'Администраторов',
                  value: formatCount(admins),
                  valueNote: 'доступ к админке',
                ),
              ),
            ],
          ),
        ),
        SizedBox(
          height: chartHeight,
          child: AnalyticsPanel(
            title: 'Регистрация пользователей',
            titleGap: 12,
            expandChild: true,
            titleTrailing: const <Widget>[
              ChartLegend(
                color: AppTheme.primaryOrange,
                label: 'новые пользователи, в день',
              ),
            ],
            child: CanonLineChart(
              data: data.registrationTimeline,
              aggregation: data.aggregation,
              emptyMessage: 'За выбранный период регистраций не было',
            ),
          ),
        ),
        _RolesPanel(data: data),
      ],
    );
  }
}

/// «По ролям»: полоса во всю ширину и легенда в строку.
class _RolesPanel extends StatelessWidget {
  final UsersAnalyticsData data;

  const _RolesPanel({required this.data});

  @override
  Widget build(BuildContext context) {
    // Порядок канонический, не пришедший с бэкенда: тот сортирует по убыванию
    // количества, и роли менялись бы местами по мере роста базы партнёров.
    // Роли кадра стоят всегда; прочие из словаря — только когда в базе есть
    // хотя бы один такой аккаунт (см. `kUserRolesAlwaysShown`).
    final counts = <String, int>{
      for (final key in kUserRoles.keys)
        if (kUserRolesAlwaysShown.contains(key) || data.roleCount(key) > 0)
          key: data.roleCount(key),
    };
    // Незнакомая роль не теряется: без неё сумма долей молча перестала бы
    // быть целым, а «94,6% + 5,0%» выглядит правдоподобно и при пропаже.
    // Складываются и повторы — так же, как у статусов; `GROUP BY role` их
    // сегодня не отдаёт, но отбрасывать строку молча значит обещать одно,
    // а делать другое.
    for (final item in data.roleDistribution) {
      if (kUserRoles.containsKey(item.label)) continue;
      counts[item.label] = (counts[item.label] ?? 0) + item.count;
    }
    final total = counts.values.fold<int>(0, (a, b) => a + b);

    if (total == 0) {
      return const AnalyticsPanel(
        title: 'По ролям',
        child: PanelEmpty('В базе пока нет пользователей'),
      );
    }

    return AnalyticsPanel(
      title: 'По ролям',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          ShareBar(
            segments: <ShareSegment>[
              for (final entry in counts.entries)
                ShareSegment(
                  color: userRoleColor(entry.key),
                  value: entry.value,
                ),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: <Widget>[
              for (final entry in counts.entries)
                Padding(
                  padding: const EdgeInsets.only(right: 28),
                  child: ShareLegendChip(
                    color: userRoleColor(entry.key),
                    label: userRoleLabel(entry.key),
                    value: entry.value,
                    total: total,
                  ),
                ),
              const Expanded(
                child: Text(
                  'Роли приходят из базы ключами — перевод на стороне клиента',
                  textAlign: TextAlign.right,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12,
                    color: AppTheme.textTertiary,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
