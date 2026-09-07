import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/cities.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/widgets/establishment_card.dart';
import 'package:restaurant_guide_mobile/widgets/results_search_bar.dart';
import 'package:restaurant_guide_mobile/config/dimensions.dart';
import 'package:restaurant_guide_mobile/screens/map/map_screen.dart';
import 'package:restaurant_guide_mobile/services/location_service.dart';

/// Results list screen displaying search results with pagination
/// Implements Figma design with dark header area and light results list
class ResultsListScreen extends StatefulWidget {
  const ResultsListScreen({super.key});

  @override
  State<ResultsListScreen> createState() => _ResultsListScreenState();
}

class _ResultsListScreenState extends State<ResultsListScreen> {
  final ScrollController _scrollController = ScrollController();
  final TextEditingController _searchController = TextEditingController();

  // Figma colors
  static const Color _backgroundColor = AppTheme.backgroundWarm;
  static const Color _greyText = AppTheme.textGrey;
  static const Color _greyStroke = AppTheme.strokeGrey;
  static const Color _secondaryOrange = AppTheme.primaryOrangeLight;
  static const Color _darkOrange = AppTheme.primaryOrangeDark;

  // City list from shared constant
  static const _citiesWithRegions = BelarusCities.citiesWithRegions;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);

    // Initialize search query from provider
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final provider = context.read<EstablishmentsProvider>();
      _searchController.text = provider.searchQuery ?? '';
      provider.searchEstablishments();
    });
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  /// Handle scroll events for pagination
  void _onScroll() {
    if (_isNearBottom) {
      context.read<EstablishmentsProvider>().loadMore();
    }
  }

  /// Check if scroll position is near bottom (within 200 pixels)
  bool get _isNearBottom {
    if (!_scrollController.hasClients) return false;
    final maxScroll = _scrollController.position.maxScrollExtent;
    final currentScroll = _scrollController.position.pixels;
    return maxScroll - currentScroll <= 200;
  }

  /// Navigate to establishment detail screen
  void _navigateToDetail(String establishmentId, {double? distanceKm}) {
    Navigator.of(context).pushNamed(
      '/establishment/$establishmentId',
      arguments: distanceKm != null ? {'distanceKm': distanceKm} : null,
    );
  }

  /// Toggle favorite status with authentication check
  void _toggleFavorite(String establishmentId) {
    final authProvider = context.read<AuthProvider>();

    if (!authProvider.isAuthenticated) {
      // Show login prompt for unauthenticated users
      _showLoginPrompt();
      return;
    }

    final provider = context.read<EstablishmentsProvider>();
    final wasFavorite = provider.isFavorite(establishmentId);

    provider.toggleFavorite(establishmentId).then((_) {
      // Show success snackbar
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              wasFavorite
                  ? 'Удалено из избранного'
                  : 'Добавлено в избранное',
            ),
            duration: const Duration(seconds: 2),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    }).catchError((error) {
      // Show error snackbar on failure
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('Не удалось обновить избранное'),
            backgroundColor: Theme.of(context).colorScheme.error,
            duration: const Duration(seconds: 2),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    });
  }

  /// Show login prompt dialog
  void _showLoginPrompt() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Требуется авторизация'),
        content: const Text(
          'Для добавления в избранное необходимо войти в аккаунт.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(context).pop();
              Navigator.of(context).pushNamed('/auth/login');
            },
            child: const Text('Войти'),
          ),
        ],
      ),
    );
  }

  /// Execute search and refresh results
  void _executeSearch() {
    final provider = context.read<EstablishmentsProvider>();
    provider.setSearchQuery(_searchController.text);
    provider.searchEstablishments();
  }

  /// Navigate to filter screen
  void _openFilters() {
    Navigator.of(context).pushNamed('/filter');
  }

  /// Show city selection bottom sheet (Figma design)
  void _showCityPicker() {
    String? tempSelectedCity;

    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.backgroundPrimary,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => StatefulBuilder(
        builder: (context, setModalState) {
          final provider = context.read<EstablishmentsProvider>();
          tempSelectedCity ??= provider.selectedCity;

          return SizedBox(
            height: MediaQuery.of(context).size.height * 0.85,
            child: Column(
              children: [
                // Header
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  decoration: const BoxDecoration(
                    color: AppTheme.backgroundPrimary,
                    border: Border(
                      bottom: BorderSide(color: _greyStroke, width: 0.5),
                    ),
                  ),
                  child: Stack(
                    alignment: Alignment.center,
                    children: [
                      Positioned(
                        left: 16,
                        child: GestureDetector(
                          onTap: () => Navigator.of(context).pop(),
                          child: const Icon(
                            Icons.chevron_left,
                            size: 25,
                            color: AppTheme.textPrimary,
                          ),
                        ),
                      ),
                      Text(
                        'Местоположение',
                        style: GoogleFonts.nunitoSans(
                          fontSize: 18,
                          fontWeight: FontWeight.w600,
                          color: AppTheme.textPrimary,
                        ),
                      ),
                      Positioned(
                        right: 16,
                        child: GestureDetector(
                          onTap: () {
                            setModalState(() {
                              tempSelectedCity = 'Минск';
                            });
                          },
                          child: const Text(
                            'Сброс',
                            style: TextStyle(
                              fontSize: 15,
                              color: AppTheme.textPrimary,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const Padding(
                  padding: EdgeInsets.fromLTRB(16, 24, 16, 16),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      'Ваш город',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w500,
                        color: AppTheme.textPrimary,
                      ),
                    ),
                  ),
                ),
                Expanded(
                  child: ListView.builder(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    itemCount: _citiesWithRegions.length,
                    itemBuilder: (context, index) {
                      final cityData = _citiesWithRegions[index];
                      final city = cityData['city']!;
                      final region = cityData['region']!;
                      final isSelected = tempSelectedCity == city;

                      return _buildCityOption(
                        city: city,
                        region: region,
                        isSelected: isSelected,
                        onTap: () {
                          setModalState(() {
                            tempSelectedCity = city;
                          });
                        },
                      );
                    },
                  ),
                ),
                Container(
                  padding: EdgeInsets.fromLTRB(
                    16,
                    24,
                    16,
                    MediaQuery.of(context).padding.bottom + 24,
                  ),
                  child: SizedBox(
                    width: 136,
                    height: 47,
                    child: ElevatedButton(
                      onPressed: () {
                        if (tempSelectedCity != null) {
                          provider.setCity(tempSelectedCity!);
                          provider.searchEstablishments();
                        }
                        Navigator.of(context).pop();
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: _darkOrange,
                        foregroundColor: AppTheme.textOnPrimary,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
                        ),
                        elevation: 0,
                      ),
                      child: const Text(
                        'Применить',
                        style: TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w400,
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  /// Build city option tile
  Widget _buildCityOption({
    required String city,
    required String region,
    required bool isSelected,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    city,
                    style: const TextStyle(fontSize: 15, color: AppTheme.textPrimary),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    region,
                    style: const TextStyle(fontSize: 13, color: _greyText),
                  ),
                ],
              ),
            ),
            Container(
              width: 24,
              height: 24,
              decoration: BoxDecoration(
                color: isSelected ? _secondaryOrange : AppTheme.backgroundPrimary,
                borderRadius: BorderRadius.circular(AppTheme.radiusXSmall),
                border: Border.all(
                  color: isSelected ? _secondaryOrange : _greyStroke,
                  width: 1,
                ),
              ),
              child: isSelected
                  ? const Icon(Icons.check, size: 16, color: AppTheme.textOnPrimary)
                  : null,
            ),
          ],
        ),
      ),
    );
  }

  /// Show sort options bottom sheet (Figma design)
  void _showSortOptions() {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => Consumer<EstablishmentsProvider>(
        builder: (context, provider, child) => SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Header with X button and centered title
              Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppDimensions.paddingM,
                  vertical: AppDimensions.paddingS,
                ),
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    // Centered title
                    Text(
                      'Сортировка',
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                    ),
                    // X button on the left
                    Align(
                      alignment: Alignment.centerLeft,
                      child: IconButton(
                        icon: const Icon(Icons.close),
                        onPressed: () => Navigator.of(context).pop(),
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints(),
                      ),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              // Sort options with checkboxes
              ...SortOption.values.map((option) {
                final isDisabled = option == SortOption.distance && !provider.hasRealLocation;
                return _buildSortOption(
                    option: option,
                    isSelected: provider.currentSort == option,
                    isDisabled: isDisabled,
                    onTap: isDisabled
                        ? null
                        : () {
                            provider.setSort(option);
                            Navigator.of(context).pop();
                          },
                  );
              }),
              const SizedBox(height: AppDimensions.paddingM),
            ],
          ),
        ),
      ),
    );
  }

  /// Build single sort option with checkbox (Figma design)
  Widget _buildSortOption({
    required SortOption option,
    required bool isSelected,
    bool isDisabled = false,
    VoidCallback? onTap,
  }) {
    final textColor = isDisabled ? Colors.grey.shade400 : null;
    final label = isDisabled
        ? '${option.displayLabel} (нужна геолокация)'
        : option.displayLabel;

    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppDimensions.paddingL,
          vertical: AppDimensions.paddingM,
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              label,
              style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                    color: textColor,
                  ),
            ),
            // Checkbox style indicator
            Container(
              width: 24,
              height: 24,
              decoration: BoxDecoration(
                color: isSelected && !isDisabled ? AppTheme.textPrimary : Colors.transparent,
                borderRadius: BorderRadius.circular(AppTheme.radiusXSmall),
                border: Border.all(
                  color: isDisabled
                      ? Colors.grey.shade300
                      : (isSelected ? AppTheme.textPrimary : Colors.grey.shade400),
                  width: 1.5,
                ),
              ),
              child: isSelected && !isDisabled
                  ? const Icon(
                      Icons.check,
                      size: 16,
                      color: AppTheme.textOnPrimary,
                    )
                  : null,
            ),
          ],
        ),
      ),
    );
  }

  /// Build non-blocking banner suggesting to enable geolocation
  Widget _buildLocationBanner(EstablishmentsProvider provider) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: AppTheme.primaryOrangeLight.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
        border: Border.all(color: AppTheme.primaryOrangeLight, width: 0.5),
      ),
      child: Row(
        children: [
          const Icon(Icons.location_off, size: 20, color: AppTheme.primaryOrangeDark),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              'Включите геолокацию, чтобы видеть заведения рядом',
              style: TextStyle(fontSize: 13, color: Colors.grey.shade800),
            ),
          ),
          const SizedBox(width: 8),
          TextButton(
            onPressed: () async {
              provider.markLocationBannerShown();
              // Try to get GPS — if fails, open app settings
              final granted = await provider.fetchUserLocation();
              if (granted && mounted) {
                provider.searchEstablishments();
              } else {
                await LocationService().openSettings();
              }
            },
            style: TextButton.styleFrom(
              foregroundColor: AppTheme.primaryOrangeDark,
              padding: const EdgeInsets.symmetric(horizontal: 8),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: const Text('Включить', style: TextStyle(fontSize: 13)),
          ),
          IconButton(
            onPressed: () => provider.markLocationBannerShown(),
            icon: const Icon(Icons.close, size: 18),
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(),
            color: Colors.grey.shade500,
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final topPadding = MediaQuery.of(context).padding.top;

    return Scaffold(
      backgroundColor: _backgroundColor,
      body: Consumer<EstablishmentsProvider>(
        builder: (context, provider, child) {
          // Loading state
          if (provider.isLoading && provider.establishments.isEmpty) {
            return Column(
              children: [
                _buildDarkHeader(provider, 1.0, topPadding),
                const Expanded(
                  child: Center(child: CircularProgressIndicator()),
                ),
              ],
            );
          }

          // Error state
          if (provider.error != null && provider.establishments.isEmpty) {
            return Column(
              children: [
                _buildDarkHeader(provider, 1.0, topPadding),
                Expanded(child: _buildErrorState(theme, provider)),
              ],
            );
          }

          // Empty state
          if (!provider.isLoading && provider.establishments.isEmpty) {
            return Column(
              children: [
                _buildDarkHeader(provider, 1.0, topPadding),
                Expanded(child: _buildEmptyState(theme)),
              ],
            );
          }

          // Results with collapsing header
          return CustomScrollView(
            controller: _scrollController,
            slivers: [
              // Collapsing header
              SliverPersistentHeader(
                pinned: true,
                delegate: _CollapsingHeaderDelegate(
                  expandedHeight: 210 + topPadding,
                  collapsedHeight: 50 + topPadding,
                  topPadding: topPadding,
                  provider: provider,
                  onCityTap: _showCityPicker,
                  onFilterTap: _openFilters,
                  onBackTap: () => Navigator.of(context).pop(),
                  onSortTap: _showSortOptions,
                  onMapTap: () {
                    Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const MapScreen()),
                    );
                  },
                  searchController: _searchController,
                  onSearchSubmitted: _executeSearch,
                ),
              ),

              // Results count
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                  child: Text(
                    'Результаты: ${provider.totalResults}',
                    style: const TextStyle(
                      fontSize: 14,
                      color: AppTheme.textPrimary,
                    ),
                  ),
                ),
              ),

              // Location banner (once per session, only when GPS denied)
              if (!provider.hasRealLocation && !provider.hasShownLocationBanner)
                SliverToBoxAdapter(
                  child: _buildLocationBanner(provider),
                ),

              // Results list
              SliverList(
                delegate: SliverChildBuilderDelegate(
                  (context, index) {
                    if (index == provider.establishments.length) {
                      return _buildPaginationLoader(provider);
                    }

                    final establishment = provider.establishments[index];
                    final isFavorite = provider.isFavorite(establishment.id);

                    // Calculate distance if user location available
                    double? distanceKm = establishment.distance;
                    if (distanceKm == null &&
                        provider.hasRealLocation &&
                        establishment.latitude != null &&
                        establishment.longitude != null) {
                      distanceKm = LocationService().calculateDistance(
                        provider.userLatitude!,
                        provider.userLongitude!,
                        establishment.latitude!,
                        establishment.longitude!,
                      );
                    }

                    return EstablishmentCard(
                      establishment: establishment,
                      isFavorite: isFavorite,
                      onTap: () => _navigateToDetail(establishment.id, distanceKm: distanceKm),
                      onFavoriteToggle: () => _toggleFavorite(establishment.id),
                      distanceKm: distanceKm,
                    );
                  },
                  childCount: provider.establishments.length +
                      (provider.hasMorePages ? 1 : 0),
                ),
              ),

              // Bottom padding
              const SliverPadding(padding: EdgeInsets.only(bottom: 20)),
            ],
          );
        },
      ),
    );
  }

  /// Build dark header area with background image (Figma design)
  /// [shrinkFactor] - 1.0 = fully expanded, 0.0 = fully collapsed
  Widget _buildDarkHeader(EstablishmentsProvider provider, double shrinkFactor, double topPadding) {
    final expandedHeight = 210 + topPadding;
    final collapsedHeight = 50 + topPadding;
    final currentHeight = collapsedHeight + (expandedHeight - collapsedHeight) * shrinkFactor;

    return SizedBox(
      height: currentHeight,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          // Background image
          Positioned.fill(
            child: Image.asset(
              'assets/images/search_background.jpg',
              fit: BoxFit.cover,
              errorBuilder: (context, error, stackTrace) {
                return Container(color: Colors.black);
              },
            ),
          ),
          // Dark overlay
          Positioned.fill(
            child: Container(
              color: Colors.black.withValues(alpha: 0.6),
            ),
          ),
          // Bottom gradient shadow
          Positioned(
            bottom: 0,
            left: 0,
            right: 0,
            height: 50,
            child: Container(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.transparent,
                    const Color(0xFFC8714B).withValues(alpha: 0.08),
                  ],
                ),
              ),
            ),
          ),
          // Content
          Positioned(
            top: topPadding,
            left: 0,
            right: 0,
            bottom: 0,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SizedBox(height: 16),
                  // City and Filter buttons row - fade out when collapsed
                  Opacity(
                    opacity: shrinkFactor.clamp(0.0, 1.0),
                    child: SizedBox(
                      height: 43 * shrinkFactor,
                      child: shrinkFactor > 0.3
                          ? _buildCityFilterRow(provider)
                          : const SizedBox.shrink(),
                    ),
                  ),
                  SizedBox(height: 16 * shrinkFactor),
                  // Search bar - fade out when collapsed
                  Opacity(
                    opacity: shrinkFactor.clamp(0.0, 1.0),
                    child: SizedBox(
                      height: 64 * shrinkFactor,
                      child: shrinkFactor > 0.3
                          ? _buildSearchBar()
                          : const SizedBox.shrink(),
                    ),
                  ),
                  SizedBox(height: 16 * shrinkFactor),
                  // Sort and Map buttons - always visible
                  _buildSortMapRow(),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Build city selector and filter button row (Figma design)
  Widget _buildCityFilterRow(EstablishmentsProvider provider) {
    return Row(
      children: [
        // City button
        GestureDetector(
          onTap: _showCityPicker,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            decoration: BoxDecoration(
              color: Colors.transparent,
              borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
              border: Border.all(color: _backgroundColor, width: 1),
            ),
            child: Text(
              provider.selectedCity ?? 'Минск',
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w500,
                color: _backgroundColor,
              ),
            ),
          ),
        ),
        const SizedBox(width: 25),
        // Filter button with badge
        GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: _openFilters,
          child: Stack(
            children: [
              Container(
                width: 53,
                height: 43,
                decoration: BoxDecoration(
                  color: Colors.transparent,
                  borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
                  border: Border.all(color: _backgroundColor, width: 1),
                ),
                child: const Icon(
                  Icons.tune,
                  color: _backgroundColor,
                  size: 20,
                ),
              ),
              if (provider.activeFilterCount > 0)
                Positioned(
                  top: -4,
                  right: -4,
                  child: Container(
                    padding: const EdgeInsets.all(4),
                    decoration: const BoxDecoration(
                      color: AppTheme.primaryOrange,
                      shape: BoxShape.circle,
                    ),
                    constraints: const BoxConstraints(
                      minWidth: 18,
                      minHeight: 18,
                    ),
                    child: Text(
                      '${provider.activeFilterCount}',
                      style: const TextStyle(
                        color: AppTheme.textOnPrimary,
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }

  /// Build search bar (Figma design — back button inside input field)
  Widget _buildSearchBar() {
    return ResultsSearchBar(
      controller: _searchController,
      onBack: () => Navigator.of(context).pop(),
      onSubmit: _executeSearch,
    );
  }

  /// Build sort and map buttons row (Figma design - white text on dark bg)
  Widget _buildSortMapRow() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          // Sort button
          GestureDetector(
            onTap: _showSortOptions,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Transform.rotate(
                  angle: 1.5708, // 90 degrees
                  child: const Icon(
                    Icons.compare_arrows,
                    size: 22,
                    color: AppTheme.textOnPrimary,
                  ),
                ),
                const SizedBox(width: 10),
                const Text(
                  'Сортировка',
                  style: TextStyle(
                    fontSize: 14,
                    color: AppTheme.textOnPrimary,
                  ),
                ),
              ],
            ),
          ),
          // Map button
          GestureDetector(
            onTap: () {
              Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const MapScreen()),
              );
            },
            child: const Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.map_outlined,
                  size: 23,
                  color: AppTheme.textOnPrimary,
                ),
                SizedBox(width: 10),
                Text(
                  'Карта',
                  style: TextStyle(
                    fontSize: 14,
                    color: AppTheme.textOnPrimary,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Build pagination loading indicator at list bottom
  Widget _buildPaginationLoader(EstablishmentsProvider provider) {
    if (!provider.isLoadingMore) {
      return const SizedBox.shrink();
    }

    return Container(
      padding: const EdgeInsets.all(AppDimensions.paddingM),
      alignment: Alignment.center,
      child: const CircularProgressIndicator(),
    );
  }

  /// Build error state widget
  Widget _buildErrorState(ThemeData theme, EstablishmentsProvider provider) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppDimensions.paddingL),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.error_outline,
              size: 64,
              color: theme.colorScheme.error,
            ),
            const SizedBox(height: AppDimensions.spacingM),
            Text(
              'Ошибка загрузки',
              style: theme.textTheme.headlineMedium,
            ),
            const SizedBox(height: AppDimensions.spacingS),
            Text(
              'Не удалось загрузить данные. Проверьте интернет-соединение.',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.secondary,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppDimensions.spacingL),
            FilledButton.icon(
              onPressed: () => provider.refresh(),
              icon: const Icon(Icons.refresh),
              label: const Text('Повторить'),
            ),
          ],
        ),
      ),
    );
  }

  /// Build empty state widget
  Widget _buildEmptyState(ThemeData theme) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppDimensions.paddingL),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.search_off,
              size: 64,
              color: theme.colorScheme.secondary,
            ),
            const SizedBox(height: AppDimensions.spacingM),
            Text(
              'Ничего не найдено',
              style: theme.textTheme.headlineMedium,
            ),
            const SizedBox(height: AppDimensions.spacingS),
            Text(
              'Попробуйте изменить параметры поиска или выбрать другой город.',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.secondary,
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

/// Custom delegate for collapsing header animation
class _CollapsingHeaderDelegate extends SliverPersistentHeaderDelegate {
  final double expandedHeight;
  final double collapsedHeight;
  final double topPadding;
  final EstablishmentsProvider provider;
  final VoidCallback onCityTap;
  final VoidCallback onFilterTap;
  final VoidCallback onBackTap;
  final VoidCallback onSortTap;
  final VoidCallback onMapTap;
  final TextEditingController searchController;
  final VoidCallback onSearchSubmitted;

  _CollapsingHeaderDelegate({
    required this.expandedHeight,
    required this.collapsedHeight,
    required this.topPadding,
    required this.provider,
    required this.onCityTap,
    required this.onFilterTap,
    required this.onBackTap,
    required this.onSortTap,
    required this.onMapTap,
    required this.searchController,
    required this.onSearchSubmitted,
  });

  // Figma colors
  static const Color _backgroundColor = AppTheme.backgroundWarm;

  @override
  double get minExtent => collapsedHeight;

  @override
  double get maxExtent => expandedHeight;

  @override
  bool shouldRebuild(covariant _CollapsingHeaderDelegate oldDelegate) {
    return expandedHeight != oldDelegate.expandedHeight ||
        collapsedHeight != oldDelegate.collapsedHeight ||
        provider != oldDelegate.provider;
  }

  @override
  Widget build(
    BuildContext context,
    double shrinkOffset,
    bool overlapsContent,
  ) {
    // Calculate shrink factor (1.0 = fully expanded, 0.0 = fully collapsed)
    final shrinkFactor =
        1.0 - (shrinkOffset / (maxExtent - minExtent)).clamp(0.0, 1.0);

    return SizedBox(
      height: maxExtent - shrinkOffset.clamp(0.0, maxExtent - minExtent),
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          // Background image
          Positioned.fill(
            child: Image.asset(
              'assets/images/search_background.jpg',
              fit: BoxFit.cover,
              errorBuilder: (context, error, stackTrace) {
                return Container(color: Colors.black);
              },
            ),
          ),
          // Dark overlay
          Positioned.fill(
            child: Container(
              color: Colors.black.withValues(alpha: 0.6),
            ),
          ),
          // Bottom gradient shadow
          Positioned(
            bottom: 0,
            left: 0,
            right: 0,
            height: 50,
            child: Container(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.transparent,
                    const Color(0xFFC8714B).withValues(alpha: 0.08),
                  ],
                ),
              ),
            ),
          ),
          // Content
          Positioned(
            top: topPadding,
            left: 0,
            right: 0,
            bottom: 0,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SizedBox(height: 16),
                  // City and Filter buttons row - fade out when collapsed
                  Opacity(
                    opacity: shrinkFactor.clamp(0.0, 1.0),
                    child: SizedBox(
                      height: 43 * shrinkFactor,
                      child: shrinkFactor > 0.3
                          ? _buildCityFilterRow()
                          : const SizedBox.shrink(),
                    ),
                  ),
                  SizedBox(height: 16 * shrinkFactor),
                  // Search bar - fade out when collapsed
                  Opacity(
                    opacity: shrinkFactor.clamp(0.0, 1.0),
                    child: SizedBox(
                      height: 64 * shrinkFactor,
                      child: shrinkFactor > 0.3
                          ? _buildSearchBar()
                          : const SizedBox.shrink(),
                    ),
                  ),
                  SizedBox(height: 16 * shrinkFactor),
                  // Sort and Map buttons - always visible
                  _buildSortMapRow(),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Build city selector and filter button row
  Widget _buildCityFilterRow() {
    return Row(
      children: [
        // City button
        GestureDetector(
          onTap: onCityTap,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            decoration: BoxDecoration(
              color: Colors.transparent,
              borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
              border: Border.all(color: _backgroundColor, width: 1),
            ),
            child: Text(
              provider.selectedCity ?? 'Минск',
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w500,
                color: _backgroundColor,
              ),
            ),
          ),
        ),
        const SizedBox(width: 25),
        // Filter button with badge
        GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: onFilterTap,
          child: Stack(
            children: [
              Container(
                width: 53,
                height: 43,
                decoration: BoxDecoration(
                  color: Colors.transparent,
                  borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
                  border: Border.all(color: _backgroundColor, width: 1),
                ),
                child: const Icon(
                  Icons.tune,
                  color: _backgroundColor,
                  size: 20,
                ),
              ),
              if (provider.activeFilterCount > 0)
                Positioned(
                  top: -4,
                  right: -4,
                  child: Container(
                    padding: const EdgeInsets.all(4),
                    decoration: const BoxDecoration(
                      color: AppTheme.primaryOrange,
                      shape: BoxShape.circle,
                    ),
                    constraints: const BoxConstraints(
                      minWidth: 18,
                      minHeight: 18,
                    ),
                    child: Text(
                      '${provider.activeFilterCount}',
                      style: const TextStyle(
                        color: AppTheme.textOnPrimary,
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }

  /// Build search bar (Figma design — back button inside input field)
  Widget _buildSearchBar() {
    return ResultsSearchBar(
      controller: searchController,
      onBack: onBackTap,
      onSubmit: onSearchSubmitted,
    );
  }

  /// Build sort and map buttons row
  Widget _buildSortMapRow() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          // Sort button
          GestureDetector(
            onTap: onSortTap,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Transform.rotate(
                  angle: 1.5708, // 90 degrees
                  child: const Icon(
                    Icons.compare_arrows,
                    size: 22,
                    color: AppTheme.textOnPrimary,
                  ),
                ),
                const SizedBox(width: 10),
                const Text(
                  'Сортировка',
                  style: TextStyle(
                    fontSize: 14,
                    color: AppTheme.textOnPrimary,
                  ),
                ),
              ],
            ),
          ),
          // Map button
          GestureDetector(
            onTap: onMapTap,
            child: const Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.map_outlined,
                  size: 23,
                  color: AppTheme.textOnPrimary,
                ),
                SizedBox(width: 10),
                Text(
                  'Карта',
                  style: TextStyle(
                    fontSize: 14,
                    color: AppTheme.textOnPrimary,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}