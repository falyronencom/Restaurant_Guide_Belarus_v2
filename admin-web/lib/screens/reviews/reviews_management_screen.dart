import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/admin_review_item.dart';
import 'package:restaurant_guide_admin_web/providers/admin_reviews_provider.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_filter_dropdown.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_column_message.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_pagination.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_screen_header.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_error_toast.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_skeleton.dart';

/// «Отзывы» — кадр 07.
///
/// Экран разбора, а не таблица: слева колонка 420 с карточками, справа панель
/// с самим отзывом. Общее с кадром 06 — шапка, фильтры-пилюли и футер
/// пагинации; различие в том, что здесь читают текст, а не сканируют строки.
class ReviewsManagementScreen extends StatefulWidget {
  const ReviewsManagementScreen({super.key});

  @override
  State<ReviewsManagementScreen> createState() =>
      _ReviewsManagementScreenState();
}

class _ReviewsManagementScreenState extends State<ReviewsManagementScreen> {
  final _searchController = TextEditingController();
  late final AdminReviewsProvider _provider;

  /// Ошибка, о которой уже сказали тостом: провайдер уведомляет много раз за
  /// одну неудачу, а тост должен появиться один.
  String? _reportedError;
  VoidCallback? _dismissToast;

  @override
  void initState() {
    super.initState();
    _provider = context.read<AdminReviewsProvider>();
    _provider.addListener(_onProviderChanged);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _provider.loadReviews();
    });
  }

  @override
  void dispose() {
    _provider.removeListener(_onProviderChanged);
    _dismissToast?.call();
    _searchController.dispose();
    super.dispose();
  }

  /// Неудача загрузки при непустом списке не должна пропадать молча.
  ///
  /// Таких неудач две: перелистывание и перечитка после действия. Вторая
  /// опаснее — само действие прошло, вернулся `true`, и без сообщения
  /// модератор видит прежние строки и считает, что ничего не случилось.
  /// Компактное сообщение показывается только при пустом списке, иначе оно
  /// снесло бы уже показанные строки.
  void _onProviderChanged() {
    final message = _provider.listError;

    if (message == null) {
      _reportedError = null;
      return;
    }
    if (_provider.reviews.isEmpty) return; // покажется сообщение в колонке
    if (message == _reportedError) return;

    _reportedError = message;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _dismissToast?.call();
      _dismissToast = showAdminErrorToast(
        context,
        title: 'Список не обновился',
        message: '$message. Отзывы на экране остались от прошлой загрузки.',
        onRetry: () => _provider.loadReviews(page: _provider.currentPage),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AdminReviewsProvider>();
    final reviews = context.read<AdminReviewsProvider>();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        AdminScreenHeader(
          title: 'Отзывы',
          subtitle: _subtitle(provider),
          busy: provider.isLoadingList && provider.reviews.isNotEmpty,
          actions: <Widget>[
            _SearchField(
              controller: _searchController,
              isSearchMode: provider.searchQuery.isNotEmpty,
              onSubmit: reviews.search,
              onClear: _clearSearch,
            ),
            AdminFilterDropdown<String>(
              value: provider.statusFilter,
              emptyLabel: 'Все статусы',
              options: const <AdminFilterOption<String>>[
                AdminFilterOption<String>(value: null, label: 'Все статусы'),
                AdminFilterOption<String>(value: 'visible', label: 'Видимые'),
                AdminFilterOption<String>(value: 'hidden', label: 'Скрытые'),
                AdminFilterOption<String>(value: 'deleted', label: 'Удалённые'),
              ],
              onChanged: reviews.setStatusFilter,
            ),
            // Оценки перечислены поштучно, а не диапазонами вроде «1–2
            // звезды» из макета: бэкенд принимает `rating` одним значением
            // (`r.rating = $N`), и пункт-диапазон обещал бы отбор, которого
            // нет. Правило то же, что у сортировки на кадре 05.
            AdminFilterDropdown<int>(
              value: provider.ratingFilter,
              emptyLabel: 'Любая оценка',
              options: <AdminFilterOption<int>>[
                const AdminFilterOption<int>(value: null, label: 'Любая оценка'),
                for (var star = 5; star >= 1; star--)
                  AdminFilterOption<int>(
                    value: star,
                    label: '$star ${plural(star, 'звезда', 'звезды', 'звёзд')}',
                  ),
              ],
              onChanged: reviews.setRatingFilter,
            ),
          ],
        ),
        Expanded(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              _ReviewListColumn(
                onClearSearch: _clearSearch,
                onResetFilters: _resetFilters,
              ),
              const Expanded(child: _DetailPanel()),
            ],
          ),
        ),
      ],
    );
  }

  /// Снимает поиск целиком — и фильтр, и текст в поле.
  ///
  /// Одной точкой на весь экран: сбросить поиск можно тремя способами
  /// (крестик в поле, строка пустого состояния, кнопка «Сбросить фильтры»), и
  /// каждый из них обязан очистить обе половины. Иначе поле шапки продолжает
  /// показывать запрос, которого в выборке уже нет.
  void _clearSearch() {
    _searchController.clear();
    context.read<AdminReviewsProvider>().clearSearch();
  }

  /// Снимает все фильтры разом — и в провайдере, и в поле поиска.
  void _resetFilters() {
    _searchController.clear();
    context.read<AdminReviewsProvider>().resetFilters();
  }

  /// «1 240 отзывов · 12 скрыто · средний рейтинг 4,3».
  ///
  /// Все три величины считаются бэкендом по ОДНОЙ выборке, поэтому под
  /// фильтром подпись описывает отфильтрованное, а не раздел целиком.
  String? _subtitle(AdminReviewsProvider provider) {
    if (provider.reviews.isEmpty) return null;

    final parts = <String>[
      countWithNoun(provider.totalCount, 'отзыв', 'отзыва', 'отзывов'),
      if (provider.hiddenCount > 0)
        '${formatCount(provider.hiddenCount)} скрыто',
      if (provider.averageRating != null)
        'средний рейтинг ${formatDecimal(provider.averageRating!)}',
    ];

    return parts.join(' · ');
  }
}

// =============================================================================
// Поиск в слоте шапки
// =============================================================================

class _SearchField extends StatelessWidget {
  final TextEditingController controller;
  final bool isSearchMode;
  final ValueChanged<String> onSubmit;
  final VoidCallback onClear;

  const _SearchField({
    required this.controller,
    required this.isSearchMode,
    required this.onSubmit,
    required this.onClear,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 260,
      height: AdminFilterDropdown.height,
      child: TextField(
        controller: controller,
        style: const TextStyle(fontSize: 14, color: AppTheme.textDark),
        textAlignVertical: TextAlignVertical.center,
        onSubmitted: (value) {
          final query = value.trim();
          if (query.isEmpty) {
            onClear();
          } else {
            onSubmit(query);
          }
        },
        decoration: InputDecoration(
          hintText: 'Текст отзыва',
          hintStyle: const TextStyle(fontSize: 14, color: AppTheme.textGrey),
          isDense: true,
          contentPadding: EdgeInsets.zero,
          prefixIcon: const Icon(
            Icons.search,
            size: 17,
            color: AppTheme.textTertiary,
          ),
          prefixIconConstraints: const BoxConstraints(minWidth: 38),
          suffixIcon: isSearchMode
              ? IconButton(
                  icon: const Icon(Icons.close, size: 17),
                  color: AppTheme.textSecondary,
                  onPressed: onClear,
                  tooltip: 'Сбросить поиск',
                )
              : null,
          // Компактное поле шапки: r10 и высота 40, как у соседних контролов
          // слота, а не общая форма поля ввода канона.
          border: _border(AppTheme.strokeGrey),
          enabledBorder: _border(AppTheme.strokeGrey),
          focusedBorder: _border(AppTheme.primaryOrange, width: 1.5),
        ),
      ),
    );
  }

  OutlineInputBorder _border(Color color, {double width = 1}) =>
      OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppTheme.radiusControl),
        borderSide: BorderSide(color: color, width: width),
      );
}

// =============================================================================
// Колонка списка
// =============================================================================

class _ReviewListColumn extends StatelessWidget {
  /// Сброс принадлежит экрану: текст поиска живёт в контроллере его шапки.
  final VoidCallback onClearSearch;
  final VoidCallback onResetFilters;

  const _ReviewListColumn({
    required this.onClearSearch,
    required this.onResetFilters,
  });

  static const double width = 420;

  static const Map<String, String> _sortCaptions = <String, String>{
    'newest': 'сначала новые',
    'oldest': 'сначала старые',
    'rating_high': 'оценка по убыванию',
    'rating_low': 'оценка по возрастанию',
  };

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AdminReviewsProvider>();

    return Container(
      width: width,
      decoration: const BoxDecoration(
        border: Border(right: BorderSide(color: AppTheme.borderLight)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          _SectionHeader(
            caption: _sortCaptions[provider.sort] ?? 'сначала новые',
            currentSort: provider.sort,
            onSortChanged: context.read<AdminReviewsProvider>().setSort,
          ),
          Expanded(child: _body(context, provider)),
          // Футер держится и на ошибке: строки от прошлой страницы на экране,
          // и убрать под ними полосу номеров значит отнять единственный
          // способ уйти с неё.
          if (provider.reviews.isNotEmpty)
            AdminPagination.narrow(
              page: provider.currentPage,
              totalPages: provider.totalPages,
              totalCount: provider.totalCount,
              perPage: AdminReviewsProvider.perPage,
              shownOnPage: provider.reviews.length,
              onPageChanged: (page) => context
                  .read<AdminReviewsProvider>()
                  .loadReviews(page: page),
            ),
        ],
      ),
    );
  }

  Widget _body(BuildContext context, AdminReviewsProvider provider) {
    // Скелетон — только когда показывать нечего. На смене страницы прежние
    // карточки остаются до прихода новых.
    if (provider.isLoadingList && provider.reviews.isEmpty) {
      return const _ListSkeleton();
    }

    final message = provider.listError;
    if (message != null && provider.reviews.isEmpty) {
      // Компактное сообщение, а не витринная `AdminErrorCard`: та шириной 400
      // и рассчитана на всю область экрана, в колонке 420 она вылезает за
      // край. Те же грабли уже находили на кадре 05.
      return AdminColumnMessage(
        icon: Icons.cloud_off_outlined,
        title: 'Отзывы не загрузились',
        message: message,
        onAction: () => context.read<AdminReviewsProvider>().loadReviews(),
      );
    }

    if (provider.reviews.isEmpty) return _empty(context, provider);

    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      itemCount: provider.reviews.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (context, index) {
        final review = provider.reviews[index];
        return _ReviewCard(
          review: review,
          isSelected: provider.selectedId == review.id,
          onTap: () =>
              context.read<AdminReviewsProvider>().selectReview(review.id),
        );
      },
    );
  }

  Widget _empty(BuildContext context, AdminReviewsProvider provider) {
    if (!provider.hasActiveFilters) {
      return const AdminColumnMessage(
        icon: Icons.rate_review_outlined,
        title: 'Отзывов пока нет',
        message: 'Здесь появятся отзывы посетителей — все сразу, включая '
            'скрытые и удалённые.',
      );
    }

    // Перечисляем, что именно отсекло: пустой список под фильтром без этого
    // выглядит как пустой раздел.
    final active = <String>[
      if (provider.searchQuery.isNotEmpty) 'поиск «${provider.searchQuery}»',
      if (provider.statusFilter != null)
        _statusFilterLabel(provider.statusFilter!),
      if (provider.ratingFilter != null)
        'оценка ${provider.ratingFilter}',
    ];

    return AdminColumnMessage(
      icon: Icons.filter_alt_off_outlined,
      title: 'Под фильтр ничего не подошло',
      message: 'Выбрано: ${active.join(', ')}.',
      actionLabel: 'Сбросить фильтры',
      onAction: onResetFilters,
    );
  }

  static String _statusFilterLabel(String status) => switch (status) {
        'visible' => 'видимые',
        'hidden' => 'скрытые',
        'deleted' => 'удалённые',
        _ => status,
      };
}

/// Шапка секции: чем является список и в каком он порядке.
class _SectionHeader extends StatelessWidget {
  final String caption;
  final String currentSort;
  final ValueChanged<String> onSortChanged;

  const _SectionHeader({
    required this.caption,
    required this.currentSort,
    required this.onSortChanged,
  });

  static const List<(String, String)> _options = <(String, String)>[
    ('newest', 'Сначала новые'),
    ('oldest', 'Сначала старые'),
    ('rating_high', 'Оценка по убыванию'),
    ('rating_low', 'Оценка по возрастанию'),
  ];

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
      child: Row(
        children: <Widget>[
          Text('Отзывы'.toUpperCase(), style: AppTheme.canonTableHeader),
          const Spacer(),
          // Меню настоящее: бэкенд принимает четыре порядка.
          PopupMenuButton<String>(
            tooltip: 'Порядок списка',
            position: PopupMenuPosition.under,
            initialValue: currentSort,
            onSelected: onSortChanged,
            itemBuilder: (_) => <PopupMenuEntry<String>>[
              for (final (value, label) in _options)
                PopupMenuItem<String>(value: value, child: Text(label)),
            ],
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  caption,
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppTheme.textTertiary,
                  ),
                ),
                const SizedBox(width: 8),
                const Icon(
                  Icons.swap_vert,
                  size: 16,
                  color: AppTheme.textSecondary,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// Статус отзыва
// =============================================================================

/// Три состояния отзыва человеческим языком.
///
/// Ключи здесь не машинные — состояние выводится из двух флагов проекции, а не
/// приходит кодом, поэтому карте кодов взяться неоткуда. Порядок проверки
/// важен: удалённый тоже невидим, но называть его «скрытым» нельзя.
enum ReviewState { visible, hidden, deleted }

ReviewState reviewStateOf(AdminReviewItem review) {
  if (review.isDeleted) return ReviewState.deleted;
  if (!review.isVisible) return ReviewState.hidden;
  return ReviewState.visible;
}

extension _ReviewStateLook on ReviewState {
  String get cardLabel => switch (this) {
        ReviewState.visible => '',
        ReviewState.hidden => 'скрыт',
        ReviewState.deleted => 'удалён',
      };

  String get panelLabel => switch (this) {
        ReviewState.visible => 'виден в приложении',
        ReviewState.hidden => 'скрыт от посетителей',
        ReviewState.deleted => 'удалён',
      };

  Color get color => switch (this) {
        ReviewState.visible => AppTheme.statusGreen,
        // Скрытие — не ошибка и не успех: канон отдаёт ему disclaimer-пару.
        ReviewState.hidden => AppTheme.disclaimerText,
        ReviewState.deleted => AppTheme.errorRed,
      };

  Color get chipBackground => switch (this) {
        ReviewState.visible => Colors.transparent,
        ReviewState.hidden => AppTheme.disclaimerBg,
        ReviewState.deleted => AppTheme.errorTint(0.10),
      };
}

// =============================================================================
// Карточка отзыва
// =============================================================================

class _ReviewCard extends StatelessWidget {
  final AdminReviewItem review;
  final bool isSelected;
  final VoidCallback onTap;

  const _ReviewCard({
    required this.review,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final state = reviewStateOf(review);
    final muted = state != ReviewState.visible;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: isSelected
              ? AppTheme.canonSelectedCardDecoration()
              : BoxDecoration(
                  color: AppTheme.backgroundWarm,
                  borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
                  // Прозрачная рамка той же ширины: без неё выбор карточки
                  // сдвигает список под ней.
                  border: Border.all(color: Colors.transparent, width: 1.5),
                ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              _authorRow(state),
              const SizedBox(height: 6),
              _placeRow(),
              const SizedBox(height: 8),
              Text(
                review.content?.trim().isNotEmpty == true
                    ? review.content!.trim()
                    : 'Отзыв без текста — только оценка',
                style: TextStyle(
                  fontSize: 13,
                  height: 1.4,
                  color: muted ? AppTheme.textTertiary : AppTheme.textDark,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              if (review.hasPartnerResponse) ...[
                const SizedBox(height: 7),
                const Row(
                  mainAxisSize: MainAxisSize.min,
                  spacing: 5,
                  children: <Widget>[
                    Icon(Icons.reply, size: 13, color: AppTheme.textSecondary),
                    Text(
                      'партнёр ответил',
                      style: TextStyle(
                        fontSize: 11,
                        color: AppTheme.textSecondary,
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _authorRow(ReviewState state) {
    final name = review.authorName?.trim();
    final hasName = name != null && name.isNotEmpty;

    return Row(
      spacing: 8,
      children: <Widget>[
        _Avatar(
          label: hasName ? name : review.authorEmail,
          muted: !hasName,
        ),
        Expanded(
          child: Text(
            hasName ? name : (review.authorEmail ?? 'Аноним'),
            // Без имени показывается адрес — величина техническая, и
            // моноширинный отличает её от имени раньше, чем прочтёшь.
            style: hasName
                ? TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: state == ReviewState.deleted
                        ? AppTheme.textSecondary
                        : AppTheme.textPrimary,
                    decoration: state == ReviewState.deleted
                        ? TextDecoration.lineThrough
                        : null,
                  )
                : AppTheme.mono(fontSize: 12, color: AppTheme.textDark),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        if (state != ReviewState.visible) _StateChip(state: state),
        Text(
          formatDayMonthShort(review.createdAt),
          style: AppTheme.mono(fontSize: 11, color: AppTheme.textGrey),
        ),
      ],
    );
  }

  Widget _placeRow() {
    return Row(
      spacing: 6,
      children: <Widget>[
        const Icon(Icons.storefront, size: 14, color: AppTheme.textGrey),
        Expanded(
          child: Text(
            _place(review) ?? 'заведение не указано',
            style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        _Stars(value: review.rating, size: 14),
      ],
    );
  }
}

String? _place(AdminReviewItem review) {
  final parts = <String>[
    if (review.establishmentName?.trim().isNotEmpty == true)
      review.establishmentName!.trim(),
    if (review.establishmentCity?.trim().isNotEmpty == true)
      review.establishmentCity!.trim(),
  ];
  return parts.isEmpty ? null : parts.join(' · ');
}

class _StateChip extends StatelessWidget {
  final ReviewState state;

  const _StateChip({required this.state});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: state.chipBackground,
        borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
      ),
      child: Text(
        state.cardLabel,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: state.color,
        ),
      ),
    );
  }
}

class _Avatar extends StatelessWidget {
  final String? label;
  final bool muted;

  const _Avatar({required this.label, required this.muted});

  @override
  Widget build(BuildContext context) {
    final trimmed = label?.trim() ?? '';

    return Container(
      width: 22,
      height: 22,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: muted ? AppTheme.textGrey : AppTheme.primaryOrangeDark,
        shape: BoxShape.circle,
      ),
      child: Text(
        trimmed.isEmpty ? '?' : trimmed.characters.first.toUpperCase(),
        style: const TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w700,
          color: AppTheme.textOnPrimary,
        ),
      ),
    );
  }
}

class _Stars extends StatelessWidget {
  final int value;
  final double size;

  const _Stars({required this.value, required this.size});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        for (var i = 1; i <= 5; i++)
          Icon(
            Icons.star,
            size: size,
            color: i <= value ? AppTheme.primaryOrange : AppTheme.strokeGrey,
          ),
      ],
    );
  }
}

class _ListSkeleton extends StatelessWidget {
  const _ListSkeleton();

  static const int _cards = 6;

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      itemCount: _cards,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (_, __) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: AppTheme.backgroundWarm,
          borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
        ),
        child: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            SkeletonBlock.line(widthFactor: 0.5, shade: SkeletonShade.strong),
            SizedBox(height: 10),
            SkeletonBlock.line(widthFactor: 0.68, shade: SkeletonShade.weak),
            SizedBox(height: 10),
            SkeletonBlock.line(widthFactor: 0.94),
            SizedBox(height: 6),
            SkeletonBlock.line(widthFactor: 0.72),
          ],
        ),
      ),
    );
  }
}

// =============================================================================
// Панель разбора
// =============================================================================

class _DetailPanel extends StatelessWidget {
  const _DetailPanel();

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AdminReviewsProvider>();
    final review = provider.selectedReview;

    if (review == null) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(
                Icons.rate_review_outlined,
                size: 34,
                color: AppTheme.textGrey,
              ),
              SizedBox(height: 12),
              Text(
                'Выберите отзыв слева',
                style: TextStyle(fontSize: 15, color: AppTheme.textSecondary),
              ),
            ],
          ),
        ),
      );
    }

    final state = reviewStateOf(review);
    // Просмотрщику действий не показываем: сервер ответил бы 403, а кнопка,
    // обещающая то, что не выполнится, читается как поломка.
    final canModerate = context.watch<AuthProvider>().canModerate;

    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Expanded(
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                spacing: 18,
                children: <Widget>[
                  _Heading(review: review, state: state),
                  _Quote(review: review),
                  if (review.hasPartnerResponse &&
                      review.partnerResponse != null)
                    _PartnerResponse(review: review),
                  _Facts(review: review),
                ],
              ),
            ),
          ),
          if (canModerate) ...<Widget>[
            const SizedBox(height: 18),
            _Actions(provider: provider, review: review, state: state),
          ],
        ],
      ),
    );
  }
}

class _Heading extends StatelessWidget {
  final AdminReviewItem review;
  final ReviewState state;

  const _Heading({required this.review, required this.state});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        // Заголовок панели — заведение, а не «Детали отзыва»: разбирают
        // отзыв всегда о чём-то, и это «что-то» здесь главное.
        Text(
          review.establishmentName?.trim().isNotEmpty == true
              ? review.establishmentName!.trim()
              : 'Заведение не указано',
          style: AppTheme.canonSectionHeader.copyWith(height: 1.1),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        const SizedBox(height: 8),
        // Сегменты усекаются, а не переносятся: перенос ломает строку
        // «город · дата · статус» пополам и читается как две разные.
        Row(
          spacing: 8,
          children: <Widget>[
            const Icon(Icons.storefront, size: 15, color: AppTheme.textGrey),
            if (review.establishmentCity?.trim().isNotEmpty == true)
              Flexible(child: _segment(review.establishmentCity!.trim())),
            const _Dot(),
            Flexible(
              child: _segment(
                'отзыв от ${formatDayMonthLocal(review.createdAt)}, '
                '${formatTimeLocal(review.createdAt)}',
              ),
            ),
            const _Dot(),
            Container(
              width: 7,
              height: 7,
              decoration: BoxDecoration(
                color: state.color,
                shape: BoxShape.circle,
              ),
            ),
            Flexible(child: _segment(state.panelLabel)),
          ],
        ),
      ],
    );
  }

  Widget _segment(String text) => Text(
        text,
        style: const TextStyle(fontSize: 14, color: AppTheme.textSecondary),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      );
}

class _Dot extends StatelessWidget {
  const _Dot();

  @override
  Widget build(BuildContext context) => const Text(
        '·',
        style: TextStyle(fontSize: 14, color: AppTheme.textGrey),
      );
}

class _Quote extends StatelessWidget {
  final AdminReviewItem review;

  const _Quote({required this.review});

  @override
  Widget build(BuildContext context) {
    final text = review.content?.trim();

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: AppTheme.canonPanelDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            spacing: 10,
            children: <Widget>[
              _Stars(value: review.rating, size: 20),
              Text('${review.rating} из 5', style: AppTheme.canonFieldValue),
              const Spacer(),
              if (review.isEdited)
                const Row(
                  mainAxisSize: MainAxisSize.min,
                  spacing: 5,
                  children: <Widget>[
                    Icon(Icons.edit, size: 15, color: AppTheme.textTertiary),
                    // Без даты: `updated_at` бьётся и действиями модератора,
                    // и выдать её за правку автора значило бы соврать.
                    Text(
                      'изменён автором',
                      style: TextStyle(
                        fontSize: 12,
                        color: AppTheme.textTertiary,
                      ),
                    ),
                  ],
                ),
            ],
          ),
          const SizedBox(height: 14),
          Text(
            text?.isNotEmpty == true
                ? text!
                : 'Автор оставил только оценку, без текста',
            style: TextStyle(
              fontFamily: AppTheme.fontCardTitleFamily,
              fontSize: 16,
              fontWeight: FontWeight.w600,
              height: 1.6,
              color: text?.isNotEmpty == true
                  ? AppTheme.textDark
                  : AppTheme.textGrey,
            ),
          ),
        ],
      ),
    );
  }
}

class _PartnerResponse extends StatelessWidget {
  final AdminReviewItem review;

  const _PartnerResponse({required this.review});

  @override
  Widget build(BuildContext context) {
    final respondedAt = review.partnerResponseAt;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: const BoxDecoration(
        color: AppTheme.backgroundPrimary,
        borderRadius: BorderRadius.horizontal(
          right: Radius.circular(AppTheme.radiusMedium),
        ),
        border: Border(
          left: BorderSide(color: AppTheme.primaryOrange, width: 2),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            spacing: 8,
            children: <Widget>[
              Text(
                'Ответ партнёра'.toUpperCase(),
                style: AppTheme.canonTableHeader,
              ),
              // Дата приходила с бэкенда с самого начала и молча
              // отбрасывалась моделью.
              if (respondedAt != null)
                Text(
                  '${formatDateLocal(respondedAt)} '
                  '${formatTimeLocal(respondedAt)}',
                  style: AppTheme.mono(fontSize: 11, color: AppTheme.textGrey),
                ),
            ],
          ),
          const SizedBox(height: 5),
          Text(
            review.partnerResponse!.trim(),
            style: const TextStyle(
              fontSize: 14,
              height: 1.5,
              color: AppTheme.textDark,
            ),
          ),
        ],
      ),
    );
  }
}

/// Три колонки, помогающие взвесить отзыв: кто написал, много ли пишет и
/// сколько он значит для оценки заведения.
///
/// Подписи «жалоб на автора нет» из макета здесь нет намеренно: механизма
/// жалоб в модели данных не существует — ни таблицы, ни миграции, — и строка
/// утверждала бы факт о несуществующей сущности. Решение владельца.
class _Facts extends StatelessWidget {
  final AdminReviewItem review;

  const _Facts({required this.review});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: AppTheme.canonCardDecoration(),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        spacing: 18,
        children: <Widget>[
          Expanded(child: _author()),
          Expanded(child: _authorStats()),
          Expanded(child: _establishmentStats()),
        ],
      ),
    );
  }

  Widget _author() {
    final name = review.authorName?.trim();
    final hasName = name != null && name.isNotEmpty;

    return _Fact(
      label: 'Автор',
      value: Row(
        spacing: 8,
        children: <Widget>[
          _Avatar(
            label: hasName ? name : review.authorEmail,
            muted: !hasName,
          ),
          Expanded(
            child: Text(
              hasName ? name : 'Без имени',
              style: hasName
                  ? AppTheme.canonFieldValue
                  : AppTheme.canonFieldValueEmpty,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
      footnote: review.authorEmail,
      footnoteMono: true,
    );
  }

  Widget _authorStats() {
    final count = review.authorReviewCount;
    final average = review.authorAverageRating;

    if (count == null) {
      return const _Fact(label: 'Отзывов от автора', value: _Unknown());
    }

    return _Fact(
      label: 'Отзывов от автора',
      value: Text(
        average == null
            ? formatCount(count)
            : '${formatCount(count)} · средний ${formatDecimal(average)}',
        style: AppTheme.canonFieldValue,
      ),
    );
  }

  Widget _establishmentStats() {
    final average = review.establishmentAverageRating;
    final count = review.establishmentReviewCount;

    if (average == null || count == null || count == 0) {
      return const _Fact(label: 'Рейтинг заведения', value: _Unknown());
    }

    final without = review.ratingWithoutThisReview;

    return _Fact(
      label: 'Рейтинг заведения',
      value: Text(
        '${formatDecimal(average)} из '
        '${countWithNoun(count, 'отзыва', 'отзывов', 'отзывов')}',
        style: AppTheme.canonFieldValue,
      ),
      // Главный вопрос модератора к плохому отзыву — насколько он тянет
      // оценку вниз. Ответ считается из тех же трёх чисел.
      //
      // Один знак после запятой, а не два. `average_rating` — `numeric(3,2)`,
      // то есть уже округлён, и при умножении на `count` ошибка растёт: при
      // «4,10 из 187» истинное значение лежит в [4,106; 4,116], и второй знак
      // был бы гаданием. Совпавшее с исходной оценкой значение печатается
      // словами: повторить то же число — не ответ на вопрос.
      footnote: without == null
          ? null
          : (formatDecimal(without) == formatDecimal(average)
              ? 'без этого отзыва оценка та же'
              : 'без этого отзыва ${formatDecimal(without)}'),
    );
  }
}

class _Fact extends StatelessWidget {
  final String label;
  final Widget value;
  final String? footnote;
  final bool footnoteMono;

  const _Fact({
    required this.label,
    required this.value,
    this.footnote,
    this.footnoteMono = false,
  });

  @override
  Widget build(BuildContext context) {
    final note = footnote?.trim();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(label, style: AppTheme.canonFieldLabel),
        const SizedBox(height: 4),
        value,
        if (note != null && note.isNotEmpty) ...[
          const SizedBox(height: 4),
          Text(
            note,
            style: footnoteMono
                ? AppTheme.mono(fontSize: 11, color: AppTheme.textGrey)
                : const TextStyle(fontSize: 11, color: AppTheme.textGrey),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ],
    );
  }
}

class _Unknown extends StatelessWidget {
  const _Unknown();

  @override
  Widget build(BuildContext context) =>
      const Text('нет данных', style: AppTheme.canonFieldValueEmpty);
}

// =============================================================================
// Действия
// =============================================================================

class _Actions extends StatelessWidget {
  final AdminReviewsProvider provider;
  final AdminReviewItem review;
  final ReviewState state;

  const _Actions({
    required this.provider,
    required this.review,
    required this.state,
  });

  @override
  Widget build(BuildContext context) {
    if (state == ReviewState.deleted) {
      return const Row(
        children: <Widget>[
          Icon(Icons.delete_outline, size: 18, color: AppTheme.textGrey),
          SizedBox(width: 8),
          Text(
            'Отзыв удалён — вернуть его нельзя',
            style: TextStyle(fontSize: 13, color: AppTheme.textSecondary),
          ),
        ],
      );
    }

    final reviews = context.read<AdminReviewsProvider>();
    final isVisible = state == ReviewState.visible;

    return Row(
      spacing: 10,
      children: <Widget>[
        OutlinedButton.icon(
          onPressed: provider.isSubmitting
              ? null
              : () {
                  if (isVisible) {
                    _confirmHide(context, reviews);
                  } else {
                    reviews.toggleVisibility();
                  }
                },
          style: AppTheme.canonCtaOutlined(),
          icon: Icon(
            isVisible ? Icons.visibility_off : Icons.visibility,
            size: 19,
          ),
          label: Text(isVisible ? 'Скрыть отзыв' : 'Показать отзыв'),
        ),
        ElevatedButton.icon(
          onPressed: provider.isSubmitting
              ? null
              : () => _confirmDelete(context, reviews),
          // Заливка ошибки, а не контур: удаление необратимо и должно
          // выглядеть тяжелее скрытия, а не так же.
          style: AppTheme.canonCtaL(backgroundColor: AppTheme.errorRed),
          icon: const Icon(Icons.delete_outline, size: 19),
          label: const Text('Удалить'),
        ),
        if (provider.isSubmitting)
          const SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        const Expanded(
          child: Text(
            'Удаление пересчитает рейтинг заведения, и отменить его нельзя',
            style: TextStyle(
              fontSize: 12,
              height: 1.45,
              color: AppTheme.textTertiary,
            ),
          ),
        ),
      ],
    );
  }

  void _confirmHide(BuildContext context, AdminReviewsProvider reviews) {
    showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Скрыть отзыв?'),
        // Про оценку сказано намеренно. Скрытие исключает отзыв из рейтинга
        // ровно так же, как удаление (`updateEstablishmentAggregates`
        // фильтрует `is_visible = true`), то есть модератор, скрывающий
        // единицу, поднимает публичную оценку заведения. Прежний текст
        // обещал только исчезновение из приложения — о последствии для
        // рейтинга модератор мог не знать.
        content: const Text(
          'Отзыв исчезнет из приложения, автор получит уведомление, '
          'а оценка заведения будет пересчитана без него. Показать отзыв '
          'снова можно в любой момент — оценка вернётся вместе с ним.',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(dialogContext).pop();
              reviews.toggleVisibility();
            },
            child: const Text('Скрыть'),
          ),
        ],
      ),
    );
  }

  Future<void> _confirmDelete(
    BuildContext context,
    AdminReviewsProvider reviews,
  ) async {
    final reason = await showDialog<String>(
      context: context,
      builder: (_) => const _DeleteReviewDialog(),
    );

    // `null` — диалог закрыли, не подтвердив (крестик, барьер, Escape,
    // «Отмена»). Пустая строка — подтвердили без причины.
    if (reason == null) return;
    reviews.deleteReview(reason.isEmpty ? null : reason);
  }
}

/// Диалог удаления отдельным виджетом, потому что он владеет контроллером.
///
/// Прежде контроллер жил в вызывающем и освобождался через
/// `showDialog(...).whenComplete(dispose)`. Течи это не давало — `whenComplete`
/// срабатывает на всех путях закрытия, — но освобождало СЛИШКОМ РАНО: future
/// завершается в момент попа маршрута, а маршрут ещё полторы сотни миллисекунд
/// уезжает, и его поддерево живо. Тронутое поле причины перестраивалось уже
/// после `dispose` и роняло «A TextEditingController was used after being
/// disposed» — ровно на основном сценарии «вписал причину, нажал Удалить».
///
/// `State.dispose` вызывается после размонтирования маршрута, то есть тогда,
/// когда поля уже нет. Причина возвращается через `Navigator.pop`.
class _DeleteReviewDialog extends StatefulWidget {
  const _DeleteReviewDialog();

  @override
  State<_DeleteReviewDialog> createState() => _DeleteReviewDialogState();
}

class _DeleteReviewDialogState extends State<_DeleteReviewDialog> {
  final _reasonController = TextEditingController();

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Удалить отзыв?'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text(
            'Отзыв будет удалён, рейтинг заведения пересчитан. '
            'Это действие нельзя отменить.',
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _reasonController,
            decoration: const InputDecoration(
              labelText: 'Причина удаления (необязательно)',
            ),
            maxLines: 2,
          ),
        ],
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Отмена'),
        ),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: AppTheme.errorRed),
          onPressed: () =>
              Navigator.of(context).pop(_reasonController.text.trim()),
          child: const Text('Удалить'),
        ),
      ],
    );
  }
}
