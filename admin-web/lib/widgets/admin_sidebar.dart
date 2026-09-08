import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/panel_roles.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';

/// Навигационный рейл админки — 260px по редизайну (было 363).
///
/// Сужение — не косметика: при 363px и высоте пункта 44 последний раздел
/// («Здоровье данных») уходил под нижний разделитель и требовал прокрутки.
/// На 260px с высотой пункта 34 весь список — 12 пунктов и 4 заголовка —
/// умещается примерно в 683px против 820 доступных.
///
/// Отступление от макета: там рейл жёстко `height:820px` без `overflow`, то
/// есть на экране ниже 820 содержимое молча обрезалось бы. Здесь список
/// прокручивается, но только когда действительно не помещается.
class AdminSidebar extends StatelessWidget {
  const AdminSidebar({super.key});

  /// Ширина вместе с правой границей (в макете `box-sizing: border-box`).
  static const double width = 260;

  @override
  Widget build(BuildContext context) {
    final location = GoRouterState.of(context).matchedLocation;

    return Container(
      width: width,
      decoration: const BoxDecoration(
        color: AppTheme.backgroundWarm,
        border: Border(right: BorderSide(color: AppTheme.beigeDivider)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const _RailHeader(),
          Expanded(child: _RailNav(location: location)),
          const _RailFooter(),
        ],
      ),
    );
  }
}

// ============================================================================
// Данные навигации
// ============================================================================

/// Какая очередь питает бейдж пункта.
enum _RailBadge { pendingModeration, menuFlags }

/// Пункт рейла.
///
/// [soon] помечает раздел-заглушку: экран существует, но осмысленного
/// содержимого там нет. Пометка нужна, чтобы тупик был виден до клика;
/// переход при этом остаётся рабочим.
class _NavEntry {
  final String title;
  final String path;
  final IconData icon;
  final bool soon;
  final _RailBadge? badge;

  const _NavEntry(
    this.title,
    this.path,
    this.icon, {
    this.soon = false,
    this.badge,
  });
}

/// Группа пунктов. [title] == null — пункты до первого заголовка секции.
class _NavGroup {
  final String? title;
  final List<_NavEntry> items;

  const _NavGroup({this.title, required this.items});
}

/// Порядок, группировка и глифы — из макета редизайна (11 кадров, идентичны).
/// «Статистика и аналитика», «Отзывы» и платежи с уведомлениями лежат под
/// заголовком «Настройки» — семантически спорно, но так в макете и так в
/// текущем коде; менять IA в рамках рескина не следует.
const List<_NavGroup> _navGroups = <_NavGroup>[
  _NavGroup(
    items: <_NavEntry>[
      _NavEntry('Панель управления', '/', Icons.space_dashboard_outlined),
    ],
  ),
  _NavGroup(
    title: 'Модерация',
    items: <_NavEntry>[
      _NavEntry('Ожидают просмотра', '/moderation/pending',
          Icons.pending_actions_outlined,
          badge: _RailBadge.pendingModeration),
      _NavEntry(
          'Одобренные', '/moderation/approved', Icons.check_circle_outline),
      _NavEntry('Отказанные', '/moderation/rejected', Icons.cancel_outlined),
      _NavEntry('Приостановленные', '/moderation/suspended',
          Icons.pause_circle_outline),
      _NavEntry(
          'Позиции меню', '/moderation/menu-items', Icons.menu_book_outlined,
          badge: _RailBadge.menuFlags),
    ],
  ),
  _NavGroup(
    title: 'Настройки',
    items: <_NavEntry>[
      _NavEntry('Статистика и аналитика', '/settings/analytics', Icons.insights),
      _NavEntry('Отзывы', '/settings/reviews', Icons.reviews_outlined),
      _NavEntry('История платежей', '/settings/payments',
          Icons.receipt_long_outlined,
          soon: true),
      _NavEntry('Уведомления', '/settings/notifications',
          Icons.notifications_outlined,
          soon: true),
    ],
  ),
  _NavGroup(
    title: 'Аудит',
    items: <_NavEntry>[
      _NavEntry('Журнал действий', '/audit-log', Icons.history),
    ],
  ),
  _NavGroup(
    title: 'Качество',
    items: <_NavEntry>[
      _NavEntry(
          'Здоровье данных', '/quality/health', Icons.monitor_heart_outlined),
    ],
  ),
];

// ============================================================================
// Блоки рейла
// ============================================================================

/// Верх: вордмарк и подпись. Паддинг 18/16/14 из макета.
class _RailHeader extends StatelessWidget {
  const _RailHeader();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 18, 16, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('NIRIVIO', style: AppTheme.canonWordmark),
          const SizedBox(height: 4),
          const Text('АДМИН-ПАНЕЛЬ', style: AppTheme.canonWordmarkCaption),
        ],
      ),
    );
  }
}

/// Список разделов. Паддинг по 8 с боков и зазор 1px — из макета:
/// пункт получается шириной 244, а не во всю ширину рейла.
class _RailNav extends StatelessWidget {
  final String location;

  const _RailNav({required this.location});

  @override
  Widget build(BuildContext context) {
    final badges = context.watch<BadgesProvider>().badges;

    final children = <Widget>[];
    for (final group in _navGroups) {
      final title = group.title;
      if (title != null) {
        children.add(_RailSectionHeader(title: title));
      }
      for (final entry in group.items) {
        children.add(_RailItem(
          entry: entry,
          isActive: location == entry.path,
          badgeCount: switch (entry.badge) {
            _RailBadge.pendingModeration => badges?.establishmentsPending,
            _RailBadge.menuFlags => badges?.menuFlags,
            null => null,
          },
        ));
      }
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        spacing: 1,
        children: children,
      ),
    );
  }
}

class _RailSectionHeader extends StatelessWidget {
  final String title;

  const _RailSectionHeader({required this.title});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(10, 14, 10, 6),
      child: Text(
        title.toUpperCase(),
        style: AppTheme.canonRailSectionHeader,
      ),
    );
  }
}

class _RailItem extends StatelessWidget {
  final _NavEntry entry;
  final bool isActive;

  /// Размер очереди. null — счётчики ещё не пришли или пункт их не имеет;
  /// ноль — очередь разобрана, и бейдж не рисуется: молчание = норма.
  final int? badgeCount;

  const _RailItem({
    required this.entry,
    required this.isActive,
    this.badgeCount,
  });

  @override
  Widget build(BuildContext context) {
    // Активность важнее пометки «скоро»: если раздел открыт, он должен
    // читаться как текущий, иначе непонятно, где ты находишься.
    final Color iconColor;
    final TextStyle labelStyle;
    if (isActive) {
      iconColor = AppTheme.primaryOrange;
      labelStyle = const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w600,
        color: AppTheme.primaryOrangeDark,
      );
    } else if (entry.soon) {
      iconColor = AppTheme.textGrey;
      labelStyle = const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w500,
        color: AppTheme.textGrey,
      );
    } else {
      iconColor = AppTheme.textSecondary;
      labelStyle = const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w500,
        color: AppTheme.textDark,
      );
    }

    final radius = BorderRadius.circular(AppTheme.radiusControl);

    return DecoratedBox(
      decoration: isActive
          ? BoxDecoration(
              color: AppTheme.backgroundPrimary,
              borderRadius: radius,
              boxShadow: AppTheme.railActiveShadow,
            )
          : const BoxDecoration(),
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          borderRadius: radius,
          onTap: () => context.go(entry.path),
          child: SizedBox(
            height: 34,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 10),
              child: Row(
                children: [
                  Icon(entry.icon, size: 18, color: iconColor),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      entry.title,
                      style: labelStyle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (entry.soon) ...[
                    const SizedBox(width: 6),
                    const Text('СКОРО', style: AppTheme.canonRailSoonLabel),
                  ],
                  if ((badgeCount ?? 0) > 0) ...[
                    const SizedBox(width: 6),
                    _QueueBadge(count: badgeCount!),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Бейдж очереди: пилюля 18×18 (шире при двузначном), брендовая @14%.
///
/// Нулевую очередь не показывает вовсе — молчание означает норму. Бейдж на
/// каждом пункте превратился бы в шум, из которого не видно, где работа.
class _QueueBadge extends StatelessWidget {
  final int count;

  const _QueueBadge({required this.count});

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minWidth: 18),
      height: 18,
      alignment: Alignment.center,
      padding: const EdgeInsets.symmetric(horizontal: 5),
      decoration: BoxDecoration(
        color: AppTheme.brandTint(0.14),
        borderRadius: BorderRadius.circular(9),
      ),
      child: Text(
        '$count',
        style: const TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          color: AppTheme.primaryOrangeDark,
        ),
      ),
    );
  }
}

/// Низ: кто вошёл и выход. Имя и роль — из AuthProvider, а не захардкожены,
/// как в макете.
class _RailFooter extends StatelessWidget {
  const _RailFooter();

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().currentUser;
    final name = user?.displayName ?? '—';
    // Роль — словом, а не ключом БД: «Только просмотр» под именем объясняет
    // просмотрщику, почему в панели нет ни одной кнопки действия.
    final role = user == null ? '' : panelRoleLabel(user.role);
    final initial = name.isNotEmpty ? name.substring(0, 1).toUpperCase() : '?';

    return Container(
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppTheme.beigeDivider)),
      ),
      padding: const EdgeInsets.all(12),
      child: Row(
        children: [
          Container(
            width: 30,
            height: 30,
            alignment: Alignment.center,
            decoration: const BoxDecoration(
              color: AppTheme.primaryOrangeDark,
              shape: BoxShape.circle,
            ),
            child: Text(
              initial,
              style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: AppTheme.textOnPrimary,
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  name,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: AppTheme.textDark,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                Text(
                  role,
                  style: const TextStyle(
                    fontSize: 11,
                    color: AppTheme.textSecondary,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Tooltip(
            message: 'Выйти',
            child: Material(
              type: MaterialType.transparency,
              child: InkWell(
                borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
                onTap: () => context.read<AuthProvider>().logout(),
                child: const Padding(
                  padding: EdgeInsets.all(4),
                  child: Icon(
                    Icons.logout,
                    size: 18,
                    color: AppTheme.textSecondary,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
