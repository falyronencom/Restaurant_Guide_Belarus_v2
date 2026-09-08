import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/providers/suspended_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_screen_header.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_catalog_list.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_detail_panel.dart';

/// Экран «Приостановленные» — заведения, временно снятые с публикации.
class SuspendedScreen extends StatefulWidget {
  const SuspendedScreen({super.key});

  @override
  State<SuspendedScreen> createState() => _SuspendedScreenState();
}

class _SuspendedScreenState extends State<SuspendedScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<SuspendedProvider>().loadSuspendedEstablishments();
    });
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<SuspendedProvider>();

    return Column(
      children: [
        AdminScreenHeader(
          title: 'Приостановленные',
          subtitle: _subtitle(provider),
          busy: provider.isLoadingList && provider.establishments.isNotEmpty,
          actions: <Widget>[
            // Действия появляются только при загруженной детали выбранного
            // заведения. Проверять один `selectedDetail` мало: провайдер не
            // обнуляет прежнюю деталь на время загрузки новой, поэтому между
            // кликом и ответом `selectedId` уже новый, а деталь ещё старая —
            // и кнопка, собранная по старой, сработала бы по новому id.
            // Панель от этого защищена своими же ранними возвратами, слот
            // шапки — нет, и защиту приходится повторить здесь.
            if (provider.selectedDetail != null &&
                !provider.isLoadingDetail &&
                provider.detailError == null)
              _EntityActions(provider: provider),
          ],
        ),
        Expanded(
          child: Row(
            children: [
              ModerationCatalogList(
                sectionTitle: 'Приостановлены',
                // `ORDER BY e.updated_at DESC` на бэкенде, параметра порядка
                // нет — подпись без меню.
                sortCaption: 'сначала новые',
                itemCount: provider.establishments.length,
                itemBuilder: (context, index) =>
                    _card(context, provider, provider.establishments[index]),
                isLoading: provider.isLoadingList,
                error: provider.listError,
                onRetry: () => context
                    .read<SuspendedProvider>()
                    .loadSuspendedEstablishments(),
                emptyTitle: 'Приостановленных нет',
                emptyMessage: 'Все заведения каталога опубликованы — снимать '
                    'с показа никого не потребовалось.',
                page: provider.currentPage,
                totalPages: provider.totalPages,
                totalCount: provider.totalCount,
                perPage: SuspendedProvider.perPage,
                onPageChanged: (page) => context
                    .read<SuspendedProvider>()
                    .loadSuspendedEstablishments(page: page),
              ),
              const Expanded(child: _DetailPanel()),
            ],
          ),
        ),
      ],
    );
  }

  String? _subtitle(SuspendedProvider provider) {
    if (provider.listError != null) return null;
    // Гасим подпись только на первой загрузке. На перелистывании данные
    // остаются на экране, и заголовок не должен мигать вместе с ними.
    if (provider.isLoadingList && provider.totalCount == 0) return null;

    final total = provider.totalCount;
    if (total == 0) return 'Приостановленных нет';

    return '${countWithNoun(total, 'заведение снято', 'заведения сняты', 'заведений снято')} с показа';
  }

  Widget _card(
    BuildContext context,
    SuspendedProvider provider,
    SuspendedEstablishmentItem item,
  ) {
    return ModerationCatalogCard(
      name: item.name,
      date: item.suspendedAt ?? item.updatedAt,
      subtitle: _typeAndCity(item),
      thumbnailUrl: item.thumbnailUrl,
      categories: item.categories,
      cuisines: item.cuisines,
      isSelected: provider.selectedId == item.id,
      onTap: () =>
          context.read<SuspendedProvider>().selectEstablishment(item.id),
      // Нижняя строка — причина приостановки. Точка статуса здесь была бы
      // пустой работой: на этом экране все записи в одном статусе, и
      // повторять его на каждой карточке нечего. Сверено с кадром 13.
      footer: _SuspendReason(
        reason: item.suspendReason,
        isSelected: provider.selectedId == item.id,
      ),
    );
  }

  static String? _typeAndCity(SuspendedEstablishmentItem item) {
    final parts = <String>[
      if (item.categories.isNotEmpty) item.categories.first.toLowerCase(),
      if (item.city != null) item.city!,
    ];
    return parts.isEmpty ? null : parts.join(' · ');
  }
}

/// Чип причины приостановки — по кадру 13.
///
/// Фон различается выбором ровно так же, как у бейджа срока ожидания в
/// кадре 05: у выбранной карточки disclaimer-бежевый, у прочих белый на
/// бежевом. Подпись остаётся коричневой в обоих случаях — цвет здесь несёт
/// смысл «приостановлено», а не выделение.
class _SuspendReason extends StatelessWidget {
  final String? reason;
  final bool isSelected;

  const _SuspendReason({required this.reason, required this.isSelected});

  @override
  Widget build(BuildContext context) {
    final text = reason?.trim();
    final hasReason = text != null && text.isNotEmpty;
    final color = hasReason ? AppTheme.disclaimerText : AppTheme.textGrey;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: isSelected ? AppTheme.disclaimerBg : AppTheme.backgroundPrimary,
        borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.pause_circle_outline, size: 13, color: color),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              hasReason ? text : 'причина не указана',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: color,
                fontStyle: hasReason ? FontStyle.normal : FontStyle.italic,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

/// Действия над выбранным заведением в слоте шапки.
///
/// «Назначить партнёра» здесь нет, хотя кадр 13 её рисует: назначение умеет
/// только `ApprovedProvider`, и заводить второй путь к тому же действию ради
/// одной кнопки — не редизайн. Возможность не потеряна: приостановленное
/// заведение находится поиском на «Одобренных», где кнопка есть.
class _EntityActions extends StatelessWidget {
  final SuspendedProvider provider;

  const _EntityActions({required this.provider});

  @override
  Widget build(BuildContext context) {
    // Просмотрщику действий не показываем: сервер ответил бы 403, а кнопка,
    // обещающая то, что не выполнится, читается как поломка.
    if (!context.watch<AuthProvider>().canModerate) {
      return const SizedBox.shrink();
    }

    // Счётчики очередей берём ДО асинхронного действия: обращаться к
    // context после await нельзя.
    final badges = context.read<BadgesProvider>();

    return ModerationEntityActions(
      establishmentName: provider.selectedDetail?.name ?? '',
      onUnsuspend: () => provider
          .unsuspendEstablishment()
          .then((ok) => ok ? badges.load() : null),
    );
  }
}

class _DetailPanel extends StatelessWidget {
  const _DetailPanel();

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<SuspendedProvider>();

    return ModerationDetailPanel(
      mode: DetailPanelMode.suspended,
      detail: provider.selectedDetail,
      isLoadingDetail: provider.isLoadingDetail,
      detailError: provider.detailError,
      selectedId: provider.selectedId,
    );
  }
}
