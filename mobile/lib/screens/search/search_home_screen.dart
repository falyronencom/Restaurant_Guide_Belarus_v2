import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/cities.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/providers/smart_search_provider.dart';
import 'package:restaurant_guide_mobile/config/dimensions.dart';
import 'package:restaurant_guide_mobile/widgets/smart_search_bar.dart';
import 'package:restaurant_guide_mobile/widgets/smart_search_suggestions.dart';
import 'package:restaurant_guide_mobile/widgets/smart_search_preview.dart';

/// Search home screen - main entry point for searching establishments
/// Implements Figma design with background image, city selector, and search
class SearchHomeScreen extends StatefulWidget {
  const SearchHomeScreen({super.key});

  @override
  State<SearchHomeScreen> createState() => _SearchHomeScreenState();
}

class _SearchHomeScreenState extends State<SearchHomeScreen> {
  final TextEditingController _searchController = TextEditingController();
  bool _isSearchFocused = false;
  bool _hasResults = false;

  // Figma colors
  static const Color _backgroundColor = AppTheme.backgroundWarm;
  static const Color _primaryOrange = AppTheme.primaryOrange;
  static const Color _greyText = AppTheme.textGrey;
  static const Color _greyStroke = AppTheme.strokeGrey;

  // Figma colors for City Selector
  static const Color _secondaryOrange = AppTheme.primaryOrangeLight;
  static const Color _darkOrange = AppTheme.primaryOrangeDark;

  @override
  void initState() {
    super.initState();
    final provider = context.read<EstablishmentsProvider>();
    _searchController.text = provider.searchQuery ?? '';

    WidgetsBinding.instance.addPostFrameCallback((_) async {
      // 1. Load persisted city or set default
      if (provider.selectedCity == null) {
        final hasSaved = await provider.loadPersistedCity();
        if (!hasSaved) {
          provider.setCity(BelarusCities.defaultCity);
        }
      }

      // 2. Request GPS location
      if (!mounted) return;
      final gpsGranted = await provider.fetchUserLocation();

      // 3. If GPS denied and no city was persisted, show city picker
      if (!gpsGranted && mounted) {
        final hadSavedCity = await provider.loadPersistedCity();
        if (!hadSavedCity) {
          _showCityPicker();
        }
      }
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  /// Show city selection bottom sheet (Figma design)
  /// Убрать клавиатуру И стереть у области память о том, кто был в фокусе.
  ///
  /// Важно бить именно по узлу в фокусе, а не по `FocusScope.of(context)`:
  /// `unfocus()` чистит список ранее сфокусированных детей у ОБЪЕМЛЮЩЕЙ
  /// области (focus_manager.dart:934). Позвав его на области роута, мы чистим
  /// историю навигатора, а сама область роута продолжает помнить строку поиска.
  /// Тогда при закрытии любой шторки роут получает `setFirstFocus`
  /// (routes.dart:1144), спускается к запомненному ребёнку — и клавиатура
  /// выезжает сама. Вызов на `primaryFocus` чистит историю той области, что
  /// реально держит поле.
  ///
  /// Второй подводный камень: `unfocus()` — no-op, если узел не в фокусе
  /// (focus_manager.dart:917), поэтому «на всякий случай» до открытия шторки
  /// он не сработает, если поле уже расфокусировано.
  void _dismissKeyboard() {
    FocusManager.instance.primaryFocus?.unfocus();
  }

  Future<void> _showCityPicker() async {
    // Снимаем фокус ДО шторки и ещё раз ПОСЛЕ неё. Иначе клавиатура выезжает
    // сама: закрывая модальный роут, Flutter возвращает фокус тому полю,
    // которое держала область под шторкой, — то есть строке поиска.
    _dismissKeyboard();

    String? tempSelectedCity;

    await showModalBottomSheet(
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
                // Header (Figma: Фильтр/Header)
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
                      // Back button (left)
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
                      // Title (center)
                      Text(
                        'Местоположение',
                        style: GoogleFonts.nunitoSans(
                          fontSize: 18,
                          fontWeight: FontWeight.w600,
                          color: AppTheme.textPrimary,
                        ),
                      ),
                      // Reset button (right)
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

                // Section title
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

                // City list
                Expanded(
                  child: ListView.builder(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    itemCount: BelarusCities.citiesWithRegions.length,
                    itemBuilder: (context, index) {
                      final cityData = BelarusCities.citiesWithRegions[index];
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

                // Apply button
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

    if (!mounted) return;
    _dismissKeyboard();
  }

  /// Build city option tile (Figma design)
  Widget _buildCityOption({
    required String city,
    required String region,
    required bool isSelected,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: 12,
          vertical: 12,
        ),
        child: Row(
          children: [
            // City name and region
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    city,
                    style: const TextStyle(
                      fontSize: 15,
                      color: AppTheme.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    region,
                    style: const TextStyle(
                      fontSize: 13,
                      color: _greyText,
                    ),
                  ),
                ],
              ),
            ),
            // Checkbox (Figma style - orange when selected)
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

  /// Navigate to filter screen
  void _openFilters() {
    // Use rootNavigator to navigate outside tab navigator
    Navigator.of(context, rootNavigator: true).pushNamed('/filter');
  }

  /// Execute search and navigate to results (existing flow — chevron without text)
  void _executeSearch() {
    final provider = context.read<EstablishmentsProvider>();
    provider.setSearchQuery(_searchController.text);

    // Clear previous results and search
    provider.searchEstablishments();

    // Navigate to results using rootNavigator to navigate outside tab navigator
    Navigator.of(context, rootNavigator: true).pushNamed('/search/results');
  }

  /// Execute smart search (AI intent parsing path)
  void _executeSmartSearch() {
    final query = _searchController.text.trim();
    if (query.isEmpty) return;

    // Dismiss keyboard so results/empty message are immediately visible
    _dismissKeyboard();

    final estProvider = context.read<EstablishmentsProvider>();
    final smartProvider = context.read<SmartSearchProvider>();

    smartProvider.executeSmartSearch(
      query,
      latitude: estProvider.userLatitude,
      longitude: estProvider.userLongitude,
      city: estProvider.selectedCity,
    );
  }

  /// Handle suggestion chip tap
  void _onChipTap(String text) {
    _searchController.text = text;
    setState(() => _isSearchFocused = false);
    _executeSmartSearch();
  }

  /// Navigate to establishment detail
  void _onEstablishmentTap(String id) {
    Navigator.of(context, rootNavigator: true).pushNamed(
      '/establishment/$id',
    );
  }

  /// "Show all" from preview → navigate to results with current query
  void _onShowAll() {
    // Только переносим фразу и переходим. Запрос делает сам экран результатов
    // в initState — иначе на один переход уходили ДВА запроса подряд, и первый
    // из них шёл со старой фразой. / Carry the phrase and navigate; the results
    // screen issues the request itself, so one tap means one request.
    context.read<EstablishmentsProvider>().setSearchQuery(_searchController.text);
    Navigator.of(context, rootNavigator: true).pushNamed('/search/results');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      // Тап по любому пустому месту закрывает клавиатуру.
      // translucent обязателен: нижнюю половину экрана занимает
      // Expanded(SingleChildScrollView) с подсказками, а прокручиваемая область
      // непрозрачна для хит-теста и раньше съедала эти тапы — работал только
      // тап по верхней части, где под контентом лежит затемняющий слой.
      // Тапы по самим подсказкам и кнопкам не задеваются: их распознаватели
      // лежат глубже и выигрывают арену жестов.
      body: GestureDetector(
        behavior: HitTestBehavior.translucent,
        onTap: () => _dismissKeyboard(),
        child: Consumer<EstablishmentsProvider>(
        builder: (context, provider, child) => Stack(
          fit: StackFit.expand,
          children: [
            // Background image with dark overlay
            _buildBackground(),

            // Dark overlay when search focused — tap to dismiss keyboard
            if (_isSearchFocused)
              Positioned.fill(
                child: GestureDetector(
                  onTap: () => _dismissKeyboard(),
                  child: AnimatedOpacity(
                    opacity: _isSearchFocused ? 0.3 : 0.0,
                    duration: const Duration(milliseconds: 200),
                    child: Container(color: Colors.black),
                  ),
                ),
              ),

            // Content
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppDimensions.paddingM,
                ),
                child: Consumer<SmartSearchProvider>(
                  builder: (context, smartProvider, _) {
                    final showCompact = smartProvider.state ==
                            SmartSearchState.results &&
                        smartProvider.smartResults.isNotEmpty;

                    // Шапка поджимается и при фокусе строки поиска — иначе на iOS
                    // всплывающая клавиатура перекрывает подсказки Smart Search.
                    final bool compact = showCompact || _isSearchFocused;

                    // Track results state for other widgets
                    WidgetsBinding.instance.addPostFrameCallback((_) {
                      if (_hasResults != showCompact) {
                        setState(() => _hasResults = showCompact);
                      }
                    });

                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Animated top spacing
                        AnimatedContainer(
                          duration: const Duration(milliseconds: 300),
                          curve: Curves.easeInOut,
                          height: compact ? 40 : 120,
                        ),

                        // Logo with animated size
                        AnimatedDefaultTextStyle(
                          duration: const Duration(milliseconds: 300),
                          curve: Curves.easeInOut,
                          style: GoogleFonts.josefinSans(
                            fontSize: compact ? 32 : 48,
                            fontWeight: FontWeight.w600,
                            color: AppTheme.textOnPrimary,
                            letterSpacing: (compact ? 32 : 48) * 0.3,
                          ),
                          child: const Text('NIRIVIO'),
                        ),

                        // Tagline — animated hide
                        AnimatedCrossFade(
                          duration: const Duration(milliseconds: 300),
                          crossFadeState: compact
                              ? CrossFadeState.showSecond
                              : CrossFadeState.showFirst,
                          firstChild: Padding(
                            padding: const EdgeInsets.only(top: 16),
                            child: _buildTagline(),
                          ),
                          secondChild: const SizedBox.shrink(),
                        ),

                        // Animated spacing before city row
                        AnimatedContainer(
                          duration: const Duration(milliseconds: 300),
                          curve: Curves.easeInOut,
                          height: compact ? 20 : 80,
                        ),

                        // City and Filter buttons row
                        _buildCityFilterRow(provider),
                        const SizedBox(height: 16),

                        // Smart Search bar
                        SmartSearchBar(
                          controller: _searchController,
                          onSubmit: _executeSmartSearch,
                          onChevronTap: _executeSearch,
                          onFocusChanged: (focused) {
                            setState(() => _isSearchFocused = focused);
                            if (!focused) return;
                            context.read<SmartSearchProvider>().clear();
                          },
                        ),
                        const SizedBox(height: 12),

                        // Scrollable area for suggestions + preview
                        Expanded(
                          child: SingleChildScrollView(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                SmartSearchSuggestions(
                                  visible: _isSearchFocused &&
                                      smartProvider.state !=
                                          SmartSearchState.results,
                                  onChipTap: _onChipTap,
                                ),
                                SmartSearchPreview(
                                  onShowAll: _onShowAll,
                                  onEstablishmentTap: _onEstablishmentTap,
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    );
                  },
                ),
              ),
            ),

          ],
        ),
      ),
      ),
    );
  }

  /// Build background with image and dark overlay
  Widget _buildBackground() {
    return Stack(
      fit: StackFit.expand,
      children: [
        // Background image
        Image.asset(
          'assets/images/search_background.jpg',
          fit: BoxFit.cover,
          errorBuilder: (context, error, stackTrace) {
            // Fallback to gradient if image not found
            return Container(
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Color(0xFF2C1810),
                    Color(0xFF1A0F0A),
                  ],
                ),
              ),
            );
          },
        ),
        // Dark overlay
        Container(
          color: Colors.black.withValues(alpha: 0.6),
        ),
        // Bottom gradient for better readability
        Positioned(
          bottom: 0,
          left: 0,
          right: 0,
          height: 150,
          child: Container(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  Colors.transparent,
                  const Color(0xFFC8714B).withValues(alpha: 0.15),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  /// Build tagline text
  Widget _buildTagline() {
    return Padding(
      padding: const EdgeInsets.only(left: 8),
      child: Text(
        'Вкусное рядом',
        style: GoogleFonts.josefinSans(
          fontSize: 16,
          fontWeight: FontWeight.w200,
          color: Colors.white.withValues(alpha: 0.85),
          letterSpacing: 16 * 0.3,
        ),
      ),
    );
  }

  /// Build city selector and filter button row
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
              // Badge for active filters
              if (provider.activeFilterCount > 0)
                Positioned(
                  top: -4,
                  right: -4,
                  child: Container(
                    padding: const EdgeInsets.all(4),
                    decoration: const BoxDecoration(
                      color: _primaryOrange,
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
}