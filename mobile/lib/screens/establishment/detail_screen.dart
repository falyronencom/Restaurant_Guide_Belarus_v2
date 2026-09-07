import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:provider/provider.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:share_plus/share_plus.dart';
import 'package:yandex_mapkit/yandex_mapkit.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/models/review.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/services/establishments_service.dart';
import 'package:restaurant_guide_mobile/services/reviews_service.dart';
import 'package:restaurant_guide_mobile/services/location_service.dart';
import 'package:restaurant_guide_mobile/services/partner_service.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';
import 'package:restaurant_guide_mobile/models/promotion.dart';
import 'package:restaurant_guide_mobile/config/dimensions.dart';
import 'package:restaurant_guide_mobile/config/establishment_attributes.dart';
import 'package:restaurant_guide_mobile/screens/reviews/write_review_screen.dart';
import 'package:restaurant_guide_mobile/screens/reviews/reviews_list_screen.dart';
import 'package:restaurant_guide_mobile/screens/map/map_screen.dart';
import 'package:restaurant_guide_mobile/screens/establishment/pdf_viewer_screen.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/widgets/map/map_marker_generator.dart';
import 'package:restaurant_guide_mobile/widgets/booking_bottom_sheet.dart';
import 'package:restaurant_guide_mobile/widgets/adaptive_title.dart';

/// Establishment detail screen displaying full information
/// Figma design: Hero image with overlay, menu carousel, attributes, map, reviews
class EstablishmentDetailScreen extends StatefulWidget {
  final String establishmentId;

  /// Pre-calculated distance from search results (avoids recalculation discrepancy)
  final double? distanceKm;

  const EstablishmentDetailScreen({
    super.key,
    required this.establishmentId,
    this.distanceKm,
  });

  @override
  State<EstablishmentDetailScreen> createState() =>
      _EstablishmentDetailScreenState();
}

class _EstablishmentDetailScreenState extends State<EstablishmentDetailScreen> {
  // Services
  final EstablishmentsService _establishmentsService = EstablishmentsService();
  final ReviewsService _reviewsService = ReviewsService();

  // State
  Establishment? _establishment;
  List<Review> _reviews = [];
  int _totalReviews = 0;
  bool _isLoading = true;
  String? _error;

  // Gallery state
  int _currentPhotoIndex = 0;
  final PageController _galleryController = PageController();

  // Description collapsed by default
  bool _isDescriptionExpanded = false;

  // Figma colors
  static const Color _backgroundColor = AppTheme.backgroundWarm;
  static const Color _primaryOrange = AppTheme.primaryOrange;
  static const Color _secondaryOrange = AppTheme.primaryOrange;
  static const Color _greenStatus = AppTheme.statusGreen;
  static const Color _navyBlue = AppTheme.accentNavy;
  static const Color _greyText = AppTheme.textGrey;

  @override
  void initState() {
    super.initState();
    _loadData();
    // Request user location for distance calculation
    WidgetsBinding.instance.addPostFrameCallback((_) {
      try {
        context.read<EstablishmentsProvider>().fetchUserLocation();
      } catch (e) {
        // Silently handle - location is optional feature
      }
    });
  }

  @override
  void dispose() {
    _galleryController.dispose();
    super.dispose();
  }

  /// Load establishment and reviews data
  Future<void> _loadData() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      // Fetch establishment details
      final establishment = await _establishmentsService.getEstablishmentById(
        widget.establishmentId,
      );

      // Fetch reviews
      final reviewsResponse = await _reviewsService.getReviewsForEstablishment(
        widget.establishmentId,
        perPage: 5,
      );

      setState(() {
        _establishment = establishment;
        _reviews = reviewsResponse.data;
        _totalReviews = reviewsResponse.meta.total;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = 'Не удалось загрузить данные';
        _isLoading = false;
      });
    }
  }

  /// Toggle favorite status
  void _toggleFavorite() {
    final authProvider = context.read<AuthProvider>();

    if (!authProvider.isAuthenticated) {
      _showLoginPrompt();
      return;
    }

    final provider = context.read<EstablishmentsProvider>();
    provider.toggleFavorite(widget.establishmentId);
  }

  /// Navigate to write review screen (with auth check)
  void _onWriteReviewTap() {
    final authProvider = context.read<AuthProvider>();
    if (!authProvider.isAuthenticated) {
      _showLoginPrompt();
      return;
    }
    Navigator.of(context)
        .push(
      MaterialPageRoute(
        builder: (context) => WriteReviewScreen(
          establishment: _establishment!,
        ),
      ),
    )
        .then((result) {
      if (result == true) {
        _loadData();
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

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return _buildLoadingState();
    }

    if (_error != null || _establishment == null) {
      return _buildErrorState();
    }

    return Scaffold(
      backgroundColor: _backgroundColor,
      body: SingleChildScrollView(
        // ClampingScrollPhysics: на iOS убирает bounce-overscroll, который
        // открывал пустой фон Scaffold над/под контентом (на Android так по умолч.).
        physics: const ClampingScrollPhysics(),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Hero section with photo and overlay info
            _buildHeroSection(),

            // Promotion trigger banner (shown when promotions exist)
            if (_establishment?.promotions != null &&
                _establishment!.promotions!.isNotEmpty)
              _buildPromotionBanner(),

            // Description section (shown when present)
            _buildDescriptionSection(),

            // Menu section
            _buildMenuSection(),

            // Divider
            _buildDivider(),

            // Attributes section
            _buildAttributesSection(),

            // Divider
            _buildDivider(),

            // Map section
            _buildMapSection(),

            // Booking CTA (only when booking enabled)
            if (_establishment?.bookingEnabled == true) _buildBookingCTA(),

            // Reviews section (dark background)
            _buildReviewsSection(),

            // Bottom padding — чёрный, чтобы низ тёмной секции «Отзывы» доходил
            // до края экрана (иначе под кнопкой виден бежевый фон Scaffold).
            Container(
              width: double.infinity,
              height: 34,
              color: AppTheme.textPrimary,
            ),
          ],
        ),
      ),
    );
  }

  /// Build loading state
  Widget _buildLoadingState() {
    return const Scaffold(
      backgroundColor: _backgroundColor,
      body: Center(
        child: CircularProgressIndicator(color: _primaryOrange),
      ),
    );
  }

  /// Build error state
  Widget _buildErrorState() {
    return Scaffold(
      backgroundColor: _backgroundColor,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: _buildBackButton(dark: true),
      ),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.error_outline,
              size: 64,
              color: Theme.of(context).colorScheme.error,
            ),
            const SizedBox(height: AppDimensions.spacingM),
            const Text(
              'Ошибка загрузки',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: AppDimensions.spacingS),
            Text(
              _error ?? 'Неизвестная ошибка',
              style: const TextStyle(color: _greyText),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppDimensions.spacingL),
            ElevatedButton.icon(
              onPressed: _loadData,
              icon: const Icon(Icons.refresh),
              label: const Text('Повторить'),
              style: ElevatedButton.styleFrom(
                backgroundColor: _primaryOrange,
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Build hero section with photo and overlay info
  Widget _buildHeroSection() {
    // Get establishment photos sorted with primary image first
    final photos = _getSortedPhotos();

    // Use thumbnailUrl (primary_image_url) as fallback if no media
    final hasPrimaryImage = _establishment!.thumbnailUrl != null;
    final hasPhotos = photos.isNotEmpty || hasPrimaryImage;

    return SizedBox(
      height: 657,
      child: Stack(
        fit: StackFit.expand,
        children: [
          // Photo gallery
          hasPhotos
              ? (photos.isNotEmpty
                  ? _buildPhotoGallery(photos)
                  : _buildPrimaryImageFallback())
              : _buildNoPhotoPlaceholder(),

          // Gradient overlay at bottom (IgnorePointer so swipe reaches PageView)
          Positioned(
            bottom: 0,
            left: 0,
            right: 0,
            height: 333,
            child: IgnorePointer(
              child: Container(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [
                      Colors.transparent,
                      Colors.black.withValues(alpha: 0.6),
                    ],
                  ),
                ),
              ),
            ),
          ),

          // Page indicator dots (only if multiple photos in media array)
          if (photos.length > 1)
            Positioned(
              top: 640,
              left: 0,
              right: 0,
              child: _buildPageIndicator(photos.length),
            ),

          // Back button
          Positioned(
            top: MediaQuery.of(context).padding.top + 36,
            left: 0,
            child: _buildBackButton(),
          ),

          // Share button — mirrored position of back button
          Positioned(
            top: MediaQuery.of(context).padding.top + 36,
            right: 0,
            child: _buildShareButton(),
          ),

          // Info overlay. Тап-обработчики внутри (адрес→карты, телефон→звонок,
          // чип→сайт/соцсеть) используют только onTap и не претендуют на
          // горизонтальный drag, поэтому свайп галереи сохраняется без IgnorePointer.
          Positioned(
            bottom: 60,
            left: 17,
            right: 17,
            child: _buildInfoOverlay(),
          ),

          // Right-side stack: рейтинг + $$ + избранное — одной bottom-привязанной
          // колонкой, чтобы делить нижнюю базу с info-оверлеем (сердечко встаёт на
          // уровень чипа «Сайт»). Раньше жёсткие top:500/585 уезжали вниз.
          Positioned(
            bottom: 60,
            right: 24,
            child: Column(
              children: [
                _buildRatingBadge(),
                const SizedBox(height: 8),
                _buildFavoriteButton(),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Build photo gallery PageView
  Widget _buildPhotoGallery(List<EstablishmentMedia> photos) {
    return PageView.builder(
      controller: _galleryController,
      itemCount: photos.length,
      onPageChanged: (index) {
        setState(() => _currentPhotoIndex = index);
      },
      itemBuilder: (context, index) {
        final photo = photos[index];
        final imageUrl = photo.url ?? photo.previewUrl ?? photo.thumbnailUrl;

        if (imageUrl == null) {
          return _buildNoPhotoPlaceholder();
        }

        return GestureDetector(
          onTap: () => _openFullscreenGallery(index),
          child: CachedNetworkImage(
            imageUrl: imageUrl,
            fit: BoxFit.cover,
            placeholder: (context, url) => Container(
              color: Colors.grey[300],
              child: const Center(
                child: CircularProgressIndicator(color: _primaryOrange),
              ),
            ),
            errorWidget: (context, url, error) => Container(
              color: Colors.grey[300],
              child: const Icon(Icons.error, size: 48),
            ),
          ),
        );
      },
    );
  }

  /// Build no photo placeholder
  Widget _buildNoPhotoPlaceholder() {
    return Container(
      color: Colors.grey[300],
      child: const Center(
        child: Icon(
          Icons.restaurant,
          size: 64,
          color: Colors.grey,
        ),
      ),
    );
  }

  /// Build primary image fallback when no media array but has thumbnailUrl
  Widget _buildPrimaryImageFallback() {
    return CachedNetworkImage(
      imageUrl: _establishment!.thumbnailUrl!,
      fit: BoxFit.cover,
      placeholder: (context, url) => Container(
        color: Colors.grey[300],
        child: const Center(
          child: CircularProgressIndicator(color: _primaryOrange),
        ),
      ),
      errorWidget: (context, url, error) => Container(
        color: Colors.grey[300],
        child: const Icon(Icons.error, size: 48),
      ),
    );
  }

  /// Build page indicator dots
  Widget _buildPageIndicator(int count) {
    final displayCount = count > 5 ? 5 : count;
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: List.generate(displayCount, (index) {
        return Container(
          width: index == _currentPhotoIndex % displayCount ? 12 : 6,
          height: 6,
          margin: const EdgeInsets.symmetric(horizontal: 2),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(3),
            color: index == _currentPhotoIndex % displayCount
                ? AppTheme.backgroundPrimary
                : Colors.white.withValues(alpha: 0.5),
          ),
        );
      }),
    );
  }

  /// Build back button — semi-transparent glass style, enlarged tap area
  Widget _buildBackButton({bool dark = false}) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => Navigator.of(context).pop(),
      child: Padding(
        padding: const EdgeInsets.only(right: 12, top: 4, bottom: 4),
        child: Container(
          width: 55,
          height: 42,
          decoration: BoxDecoration(
            color: Colors.black.withValues(alpha: 0.45),
            borderRadius: const BorderRadius.only(
              topRight: Radius.circular(8),
              bottomRight: Radius.circular(8),
            ),
          ),
          child: const Center(
            child: Icon(
              Icons.chevron_left,
              color: AppTheme.textOnPrimary,
              size: 28,
            ),
          ),
        ),
      ),
    );
  }

  /// Build share button — semi-transparent glass style, enlarged tap area
  Widget _buildShareButton() {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: _shareEstablishment,
      child: Padding(
        padding: const EdgeInsets.only(left: 12, top: 4, bottom: 4),
        child: Container(
          width: 55,
          height: 42,
          decoration: BoxDecoration(
            color: Colors.black.withValues(alpha: 0.45),
            borderRadius: const BorderRadius.only(
              topLeft: Radius.circular(8),
              bottomLeft: Radius.circular(8),
            ),
          ),
          child: const Center(
            child: Icon(
              Icons.ios_share,
              color: AppTheme.textOnPrimary,
              size: 24,
            ),
          ),
        ),
      ),
    );
  }

  /// Share establishment info via native share sheet
  void _shareEstablishment() {
    if (_establishment == null) return;

    final name = _establishment!.name;
    final category = _establishment!.category.toLowerCase();
    final address = '${_establishment!.address}, ${_establishment!.city}';

    final buffer = StringBuffer();
    buffer.writeln('$name — $category');
    buffer.writeln('📍 $address');

    if (_establishment!.phone != null && _establishment!.phone!.isNotEmpty) {
      buffer.writeln('📞 ${_establishment!.phone}');
    }

    if (_establishment!.website != null &&
        _establishment!.website!.isNotEmpty) {
      buffer.writeln('🔗 ${_establishment!.website}');
    }

    buffer.writeln('\nНайдено в Restaurant Guide Belarus');

    Share.share(buffer.toString());
  }

  /// Build favorite button
  Widget _buildFavoriteButton() {
    return Consumer<EstablishmentsProvider>(
      builder: (context, provider, child) {
        final isFavorite = provider.isFavorite(widget.establishmentId);

        return GestureDetector(
          onTap: _toggleFavorite,
          child: Icon(
            isFavorite ? Icons.favorite : Icons.favorite_border,
            color: isFavorite ? _primaryOrange : _backgroundColor,
            size: 30,
          ),
        );
      },
    );
  }

  /// Build info overlay on hero image
  Widget _buildInfoOverlay() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Name — кегль подбирается по ширине экрана: 50 задумано под макет,
        // но Unbounded широкий, и на 384dp «Осмоловка» рвалась по буквам
        AdaptiveTitle(
          text: _establishment!.name,
          minFontSize: 30,
          style: TextStyle(
            fontFamily: AppTheme.fontDisplayFamily,
            fontSize: 50,
            fontWeight: FontWeight.w400,
            color: _backgroundColor,
          ),
        ),

        // Category
        Text(
          _establishment!.category.toLowerCase(),
          style: const TextStyle(
            fontSize: 20,
            color: _backgroundColor,
          ),
        ),

        // Cuisine
        if (_establishment!.cuisine != null)
          Opacity(
            opacity: 0.7,
            child: Text(
              '{${_establishment!.cuisine!.toLowerCase()}}',
              style: const TextStyle(
                fontSize: 18,
                color: _backgroundColor,
              ),
            ),
          ),

        const SizedBox(height: 16),

        // Status (Open/Closed)
        _buildStatusLine(),

        const SizedBox(height: 8),

        // Address
        GestureDetector(
          onTap: _showAddressSheet,
          child: Text(
            _establishment!.address,
            style: const TextStyle(
              fontSize: 16,
              color: _backgroundColor,
              decoration: TextDecoration.underline,
            ),
          ),
        ),

        const SizedBox(height: 8),

        // Phone (tappable — opens dialer and tracks call event)
        if (_establishment!.phone != null && _establishment!.phone!.isNotEmpty)
          GestureDetector(
            onTap: () => _launchPhoneCall(_establishment!.phone!),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.phone, size: 16, color: _backgroundColor),
                const SizedBox(width: 6),
                Text(
                  _establishment!.phone!,
                  style: const TextStyle(
                    fontSize: 16,
                    color: _backgroundColor,
                    decoration: TextDecoration.underline,
                  ),
                ),
              ],
            ),
          ),

        // Social link chip (Booking-style)
        if (_establishment!.website != null &&
            _establishment!.website!.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 10),
            child: _buildSocialChip(_establishment!.website!),
          ),
      ],
    );
  }

  /// Build social link chip (Booking-style — tappable, opens URL)
  Widget _buildSocialChip(String url) {
    final info = _parseSocialLink(url);
    return GestureDetector(
      onTap: () => _showLinkSheet(url),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.2),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: Colors.white.withValues(alpha: 0.4)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(info.$1, size: 16, color: _backgroundColor),
            const SizedBox(width: 6),
            Text(
              info.$2,
              style: const TextStyle(
                fontSize: 14,
                color: _backgroundColor,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Detect social platform from URL
  (IconData, String) _parseSocialLink(String url) {
    final lower = url.toLowerCase();
    if (lower.contains('instagram.com') || lower.contains('instagram')) {
      return (Icons.camera_alt, 'Instagram');
    }
    if (lower.contains('facebook.com') || lower.contains('fb.com')) {
      return (Icons.facebook, 'Facebook');
    }
    if (lower.contains('t.me') || lower.contains('telegram')) {
      return (Icons.telegram, 'Telegram');
    }
    if (lower.contains('vk.com') || lower.contains('vkontakte')) {
      return (Icons.groups, 'VK');
    }
    return (Icons.language, 'Сайт');
  }

  /// Launch phone dialer and track call event (fire-and-forget)
  Future<void> _launchPhoneCall(String phone) async {
    final uri = Uri(scheme: 'tel', path: phone.replaceAll(' ', ''));
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri);
    }
    // Track call event (fire-and-forget)
    if (_establishment?.id != null) {
      PartnerService().trackCall(_establishment!.id);
    }
  }

  /// Launch social URL in external browser/app
  Future<void> _launchSocialUrl(String url) async {
    // Ensure URL has scheme
    String fullUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      fullUrl = 'https://$url';
    }
    final uri = Uri.parse(fullUrl);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  /// Bottom-sheet выбора действия — держит пользователя в приложении до
  /// осознанного перехода (адрес/сайт/соцсеть): выбор навигатора + «копировать».
  void _showActionSheet(
      List<({IconData icon, String label, VoidCallback onTap})> actions) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.backgroundPrimary,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 12),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppTheme.strokeGrey,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 8),
            for (final a in actions)
              ListTile(
                leading: Icon(a.icon, color: AppTheme.textPrimary),
                title: Text(
                  a.label,
                  style: const TextStyle(
                    fontSize: 16,
                    color: AppTheme.textPrimary,
                  ),
                ),
                onTap: () {
                  Navigator.of(ctx).pop();
                  a.onTap();
                },
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  /// Адрес → выбор навигатора / копирование (вместо мгновенного ухода в карты).
  void _showAddressSheet() {
    final address = _establishment!.address;
    final lat = _establishment!.latitude;
    final lng = _establishment!.longitude;
    final hasCoords = lat != null && lng != null;
    _showActionSheet([
      if (hasCoords)
        (
          icon: Icons.map_outlined,
          label: 'Яндекс.Карты',
          onTap: () => _launchYandexMaps(lat, lng, address),
        ),
      if (hasCoords)
        (
          icon: Icons.public,
          label: 'Google Карты',
          onTap: () => _launchGoogleMaps(lat, lng),
        ),
      (
        icon: Icons.copy_outlined,
        label: 'Скопировать адрес',
        onTap: () => _copyToClipboard(address, 'Адрес скопирован'),
      ),
    ]);
  }

  /// Сайт/соцсеть → открыть (адаптивно под платформу) / копировать / поделиться.
  void _showLinkSheet(String url) {
    final info = _parseSocialLink(url);
    final openLabel =
        info.$2 == 'Сайт' ? 'Открыть сайт' : 'Открыть в ${info.$2}';
    _showActionSheet([
      (icon: info.$1, label: openLabel, onTap: () => _launchSocialUrl(url)),
      (
        icon: Icons.copy_outlined,
        label: 'Скопировать ссылку',
        onTap: () => _copyToClipboard(url, 'Ссылка скопирована'),
      ),
      (
        icon: Icons.ios_share,
        label: 'Поделиться',
        onTap: () => Share.share(url),
      ),
    ]);
  }

  /// Открыть адрес в Яндекс.Картах (приложение → geo: → браузер).
  Future<void> _launchYandexMaps(
      double? lat, double? lng, String address) async {
    if (lat == null || lng == null) return;
    final yandexUrl = Uri.parse(
        'yandexmaps://maps.yandex.ru/?pt=$lng,$lat&z=17&text=${Uri.encodeComponent(address)}');
    final geoUrl =
        Uri.parse('geo:$lat,$lng?q=${Uri.encodeComponent(address)}');
    final webUrl = Uri.parse(
        'https://yandex.by/maps/?pt=$lng,$lat&z=17&text=${Uri.encodeComponent(address)}');
    if (await canLaunchUrl(yandexUrl)) {
      await launchUrl(yandexUrl);
    } else if (await canLaunchUrl(geoUrl)) {
      await launchUrl(geoUrl);
    } else {
      await launchUrl(webUrl, mode: LaunchMode.externalApplication);
    }
  }

  /// Открыть адрес в Google Картах (браузер/приложение).
  Future<void> _launchGoogleMaps(double? lat, double? lng) async {
    if (lat == null || lng == null) return;
    final url = Uri.parse(
        'https://www.google.com/maps/search/?api=1&query=$lat,$lng');
    await launchUrl(url, mode: LaunchMode.externalApplication);
  }

  /// Скопировать текст в буфер обмена + подтверждение.
  void _copyToClipboard(String text, String message) {
    Clipboard.setData(ClipboardData(text: text));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        duration: const Duration(seconds: 2),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  /// Build status line (Open/Closed with time)
  Widget _buildStatusLine() {
    final isOpen = _establishment!.isCurrentlyOpen;
    final closingTime = _establishment!.todayClosingTime;

    return RichText(
      text: TextSpan(
        style: const TextStyle(fontSize: 18),
        children: [
          TextSpan(
            text: isOpen ? 'Открыто' : 'Закрыто',
            style: TextStyle(
              color: isOpen ? _greenStatus : Colors.red,
              fontWeight: FontWeight.w500,
            ),
          ),
          if (closingTime != null && isOpen)
            TextSpan(
              text: '/до $closingTime',
              style: const TextStyle(color: _backgroundColor),
            ),
        ],
      ),
    );
  }

  /// Build rating badge (green square) - Figma: 50x50 with 12px radius
  Widget _buildRatingBadge() {
    return Column(
      children: [
        // Rating
        Container(
          width: 50,
          height: 50,
          decoration: BoxDecoration(
            color: _greenStatus,
            borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
          ),
          child: Center(
            child: Text(
              _establishment!.rating?.toStringAsFixed(1) ?? '—',
              style: const TextStyle(
                fontSize: 25,
                fontWeight: FontWeight.w400,
                color: _backgroundColor,
              ),
            ),
          ),
        ),
        const SizedBox(height: 8),
        // Price
        Text(
          _getPriceSymbol(_establishment!.priceRange ?? ''),
          style: const TextStyle(
            fontSize: 20,
            color: _backgroundColor,
          ),
        ),
      ],
    );
  }

  /// Get price symbol
  String _getPriceSymbol(String priceRange) {
    switch (priceRange.toLowerCase()) {
      case 'budget':
      case 'low':
        return '\$';
      case 'moderate':
      case 'medium':
        return '\$\$';
      case 'expensive':
      case 'high':
        return '\$\$\$';
      default:
        return '\$\$';
    }
  }

  /// Get distance text for display
  /// Priority: 1) passed distanceKm from search results, 2) backend distance,
  /// 3) client-side calculation, 4) null
  String? _getDistanceText() {
    if (_establishment == null) {
      return null;
    }

    // 1. Use distance passed from search results (exact match with card)
    if (widget.distanceKm != null) {
      return _formatDistance(widget.distanceKm!);
    }

    // 2. Try backend-provided distance
    if (_establishment!.distance != null) {
      return _formatDistance(_establishment!.distance!);
    }

    // 3. Fallback: calculate client-side if we have user location
    final provider = context.read<EstablishmentsProvider>();

    if (provider.hasRealLocation &&
        _establishment!.latitude != null &&
        _establishment!.longitude != null) {
      final distance = LocationService().calculateDistance(
        provider.userLatitude!,
        provider.userLongitude!,
        _establishment!.latitude!,
        _establishment!.longitude!,
      );
      return _formatDistance(distance);
    }

    return null; // Hide if no location available
  }

  /// Format distance for display
  String _formatDistance(double km) {
    if (km < 1) {
      return '${(km * 1000).round()} м от вас';
    }
    return '${km.toStringAsFixed(1)} км от вас';
  }

  /// Get establishment photos sorted with primary image first.
  /// Matches primary by url against thumbnailUrl (primary_image_url).
  List<EstablishmentMedia> _getSortedPhotos() {
    final photos = (_establishment!.media ?? [])
        .where((m) => m.type == 'photo' || m.type == 'interior')
        .toList();

    if (photos.isEmpty) return photos;

    final primaryUrl = _establishment!.thumbnailUrl;
    if (primaryUrl == null) return photos;

    final primaryIndex = photos.indexWhere(
      (m) => m.url == primaryUrl || m.thumbnailUrl == primaryUrl,
    );
    if (primaryIndex > 0) {
      final primary = photos.removeAt(primaryIndex);
      photos.insert(0, primary);
    }

    return photos;
  }

  /// Build menu section
  Widget _buildMenuSection() {
    final media = _establishment!.media ?? [];
    final menuPdfs =
        media.where((m) => m.type == 'menu' && m.isPdf).toList()
          ..sort((a, b) => a.position.compareTo(b.position));
    final menuImages =
        media.where((m) => m.type == 'menu' && !m.isPdf).toList();

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Title
          Text(
            'Меню',
            style: TextStyle(
              fontFamily: AppTheme.fontDisplayFamily,
              fontSize: 30,
              fontWeight: FontWeight.w400,
              color: AppTheme.textPrimary,
            ),
          ),
          const SizedBox(height: 19),

          // Working hours
          _buildWorkingHours(),

          const SizedBox(height: 30),

          // PDF menu block (separate from photo carousel — UX decision
          // from session 2026-04-17: PDFs are first-class menu documents,
          // photos are supplementary)
          if (menuPdfs.isNotEmpty) ...[
            ...menuPdfs.map(
              (pdf) => Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: _PdfMenuCard(
                  pdf: pdf,
                  onTap: () => _openPdf(pdf),
                ),
              ),
            ),
            if (menuImages.isNotEmpty) ...[
              const SizedBox(height: 8),
              const _MenuSubsectionLabel(label: 'Фото меню'),
              const SizedBox(height: 16),
            ],
          ],

          // Menu photo carousel (photos only — PDFs handled above)
          if (menuImages.isNotEmpty) _buildMenuCarousel(),
        ],
      ),
    );
  }

  /// Open PDF in embedded viewer
  void _openPdf(EstablishmentMedia pdf) {
    final url = pdf.url;
    if (url == null) return;
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => PdfViewerScreen(
          pdfUrl: url,
          title: pdf.caption ?? 'Меню',
        ),
      ),
    );
  }

  /// Build working hours from real data with day grouping
  Widget _buildWorkingHours() {
    final workingHours = _establishment!.workingHours;

    if (workingHours == null) {
      return const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _WorkingHoursRow(label: 'График не указан', time: ''),
        ],
      );
    }

    const dayKeys = [
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday'
    ];
    const shortDayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    final todayIndex = DateTime.now().weekday - 1;

    // Parse each day's hours
    final dayEntries = <Map<String, dynamic>>[];
    for (int i = 0; i < 7; i++) {
      final parsed = Establishment.parseDayHours(workingHours[dayKeys[i]]);
      dayEntries.add({
        'dayName': shortDayNames[i],
        'hours': parsed,
        'isToday': i == todayIndex,
      });
    }

    // Group consecutive days with identical hours
    final groups = <Map<String, dynamic>>[];
    int i = 0;
    while (i < dayEntries.length) {
      final currentTime = _formatDayHours(dayEntries[i]['hours']);
      int j = i + 1;
      bool groupContainsToday = dayEntries[i]['isToday'] as bool;

      while (j < dayEntries.length) {
        if (_formatDayHours(dayEntries[j]['hours']) == currentTime) {
          if (dayEntries[j]['isToday'] as bool) groupContainsToday = true;
          j++;
        } else {
          break;
        }
      }

      final startDay = dayEntries[i]['dayName'] as String;
      final endDay = dayEntries[j - 1]['dayName'] as String;
      final label = i == j - 1 ? '$startDay:' : '$startDay-$endDay:';

      groups.add({
        'label': label,
        'time': currentTime,
        'isToday': groupContainsToday,
      });

      i = j;
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: groups
          .map((g) => _WorkingHoursRow(
                label: g['label'] as String,
                time: g['time'] as String,
                isHighlighted: g['isToday'] as bool,
              ))
          .toList(),
    );
  }

  /// Format parsed day hours into display string
  String _formatDayHours(Map<String, dynamic>? hours) {
    if (hours == null) return 'Выходной';
    if (hours['is_open'] == false) return 'Выходной';
    final open = hours['open'] as String?;
    final close = hours['close'] as String?;
    if (open == null || close == null) return 'Выходной';
    return '$open - $close';
  }

  /// Build menu carousel
  Widget _buildMenuCarousel() {
    // Filter only menu photos (exclude PDFs — they're rendered in a
    // dedicated block above this carousel).
    final menuPhotos =
        _establishment!.media!.where((m) => m.type == 'menu' && !m.isPdf).toList();

    if (menuPhotos.isEmpty) {
      return const SizedBox.shrink();
    }

    return SizedBox(
      height: 275,
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        itemCount: menuPhotos.length > 4 ? 4 : menuPhotos.length,
        itemBuilder: (context, index) {
          final photo = menuPhotos[index];
          final imageUrl = photo.previewUrl ?? photo.url ?? photo.thumbnailUrl;
          final maxIndex = (menuPhotos.length > 4 ? 4 : menuPhotos.length) - 1;

          return GestureDetector(
            onTap: () => _openMenuGallery(index),
            child: Container(
              width: 165,
              margin: EdgeInsets.only(right: index < maxIndex ? 10 : 0),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.only(
                  topLeft: index == 0
                      ? const Radius.circular(30)
                      : const Radius.circular(10),
                  topRight: const Radius.circular(10),
                  bottomLeft: const Radius.circular(10),
                  bottomRight: index == maxIndex
                      ? const Radius.circular(30)
                      : const Radius.circular(10),
                ),
                boxShadow: [
                  BoxShadow(
                    color: AppTheme.primaryOrangeShadow.withValues(alpha: 0.04),
                    blurRadius: 15,
                    spreadRadius: 2,
                    offset: const Offset(4, 4),
                  ),
                  BoxShadow(
                    color: AppTheme.primaryOrangeShadow.withValues(alpha: 0.04),
                    blurRadius: 15,
                    spreadRadius: 2,
                    offset: const Offset(-4, -4),
                  ),
                ],
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.only(
                  topLeft: index == 0
                      ? const Radius.circular(30)
                      : const Radius.circular(10),
                  topRight: const Radius.circular(10),
                  bottomLeft: const Radius.circular(10),
                  bottomRight: index == maxIndex
                      ? const Radius.circular(30)
                      : const Radius.circular(10),
                ),
                child: imageUrl != null
                    ? CachedNetworkImage(
                        imageUrl: imageUrl,
                        fit: BoxFit.cover,
                        placeholder: (context, url) => Container(
                          color: Colors.grey[200],
                        ),
                        errorWidget: (context, url, error) => Container(
                          color: Colors.grey[200],
                          child: const Icon(Icons.error),
                        ),
                      )
                    : Container(color: Colors.grey[200]),
              ),
            ),
          );
        },
      ),
    );
  }

  /// Build collapsible description section
  Widget _buildDescriptionSection() {
    final description = _establishment?.description;
    if (description == null || description.isEmpty) {
      return const SizedBox.shrink();
    }

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Tappable header
          GestureDetector(
            onTap: () {
              setState(() {
                _isDescriptionExpanded = !_isDescriptionExpanded;
              });
            },
            behavior: HitTestBehavior.opaque,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 16),
              child: Row(
                children: [
                  Text(
                    'Описание',
                    style: TextStyle(
                      fontFamily: AppTheme.fontDisplayFamily,
                      fontSize: 30,
                      fontWeight: FontWeight.w400,
                      color: AppTheme.textPrimary,
                    ),
                  ),
                  const SizedBox(width: 8),
                  AnimatedRotation(
                    turns: _isDescriptionExpanded ? 0.5 : 0.0,
                    duration: const Duration(milliseconds: 200),
                    child: const Icon(
                      Icons.keyboard_arrow_down,
                      size: 28,
                      color: AppTheme.textPrimary,
                    ),
                  ),
                ],
              ),
            ),
          ),
          // Collapsible body
          AnimatedSize(
            duration: const Duration(milliseconds: 250),
            curve: Curves.easeInOut,
            alignment: Alignment.topCenter,
            child: _isDescriptionExpanded
                ? Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: Text(
                      description,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w400,
                        color: Colors.black87,
                        height: 1.5,
                      ),
                    ),
                  )
                : const SizedBox.shrink(),
          ),
        ],
      ),
    );
  }

  Widget _buildDivider() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      child: const Divider(
        color: AppTheme.strokeGrey,
        height: 1,
      ),
    );
  }

  /// Build attributes section
  Widget _buildAttributesSection() {
    final amenities =
        EstablishmentAttributes.active(_establishment!.attributes);

    // Пустые атрибуты — это «данных нет», а не повод их придумать. Прежний код
    // при пустом наборе подставлял «Доставка еды · Wi-Fi · Терасса», и гость не
    // мог отличить подстановку от факта; карточки на старте заполняются вручную,
    // так что пустые attributes — обычное дело. Раздел просто не показывается.
    if (amenities.isEmpty) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Title
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Text(
              'Атрибуты',
              style: TextStyle(
                fontFamily: AppTheme.fontDisplayFamily,
                fontSize: 30,
                fontWeight: FontWeight.w400,
                color: AppTheme.textPrimary,
              ),
            ),
          ),
          const SizedBox(height: 24),

          // Amenities horizontal carousel
          SizedBox(
            height: 105,
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              itemCount: amenities.length,
              itemBuilder: (context, index) {
                final amenity = amenities[index];
                return Padding(
                  padding: EdgeInsets.only(
                    right: index < amenities.length - 1 ? 24 : 0,
                  ),
                  child: _buildAmenityItem(
                    amenity['name'] as String,
                    amenity['svg'] as String,
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  /// Build amenity item (SVG already contains circle background + white icon)
  Widget _buildAmenityItem(String label, String svgFileName) {
    return Column(
      children: [
        // SVG is a full circle badge with icon inside
        SvgPicture.asset(
          'assets/icons/$svgFileName.svg',
          width: 60,
          height: 60,
        ),
        const SizedBox(height: 8),
        // Label
        Text(
          label,
          style: const TextStyle(
            fontSize: 15,
            color: AppTheme.textPrimary,
          ),
          textAlign: TextAlign.center,
        ),
      ],
    );
  }

  /// Build map section
  Widget _buildMapSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Header with address
        Container(
          padding: const EdgeInsets.all(20),
          decoration: const BoxDecoration(
            color: _backgroundColor,
            borderRadius: BorderRadius.only(
              bottomLeft: Radius.circular(30),
              bottomRight: Radius.circular(30),
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Title
              Text(
                'Карта',
                style: TextStyle(
                  fontFamily: AppTheme.fontDisplayFamily,
                  fontSize: 30,
                  fontWeight: FontWeight.w400,
                  color: AppTheme.textPrimary,
                ),
              ),
              const SizedBox(height: 14),

              // Distance (dynamic) - uses Consumer to rebuild when location updates
              Consumer<EstablishmentsProvider>(
                builder: (context, provider, _) {
                  final distanceText = _getDistanceText();
                  if (distanceText == null) return const SizedBox.shrink();
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 14),
                    child: Text(
                      distanceText,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w500,
                        color: _secondaryOrange,
                      ),
                    ),
                  );
                },
              ),

              // Address
              Text(
                '${_establishment!.address},\n${_establishment!.city}',
                style: const TextStyle(
                  fontSize: 16,
                  color: AppTheme.textPrimary,
                ),
              ),
            ],
          ),
        ),

        // Mini-map with establishment marker (tap to explore)
        GestureDetector(
          onTap: _establishment!.latitude != null &&
                  _establishment!.longitude != null
              ? () => _openMapExplorer()
              : null,
          child: Container(
            height: 384,
            margin: const EdgeInsets.symmetric(horizontal: 4),
            decoration: BoxDecoration(
              color: Colors.grey[300],
              borderRadius: const BorderRadius.only(
                topLeft: Radius.circular(30),
                topRight: Radius.circular(30),
                bottomLeft: Radius.circular(30),
              ),
              boxShadow: [
                BoxShadow(
                  color: AppTheme.primaryOrangeShadow.withValues(alpha: 0.04),
                  blurRadius: 15,
                  spreadRadius: 2,
                  offset: const Offset(4, 4),
                ),
              ],
            ),
            child: _establishment!.latitude != null &&
                    _establishment!.longitude != null
                ? Stack(
                    children: [
                      ClipRRect(
                        borderRadius: const BorderRadius.only(
                          topLeft: Radius.circular(30),
                          topRight: Radius.circular(30),
                          bottomLeft: Radius.circular(30),
                        ),
                        child: _EstablishmentMiniMap(
                          latitude: _establishment!.latitude!,
                          longitude: _establishment!.longitude!,
                          isOpen: _establishment?.isCurrentlyOpen ?? true,
                        ),
                      ),
                      // Tap hint overlay
                      Positioned(
                        bottom: 16,
                        left: 0,
                        right: 0,
                        child: Center(
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 16, vertical: 8),
                            decoration: BoxDecoration(
                              color: Colors.black.withValues(alpha: 0.6),
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: const Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.touch_app,
                                    color: AppTheme.textOnPrimary, size: 16),
                                SizedBox(width: 6),
                                Text(
                                  'Нажмите для исследования',
                                  style: TextStyle(
                                    color: AppTheme.textOnPrimary,
                                    fontSize: 13,
                                    fontWeight: FontWeight.w500,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ],
                  )
                : const Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.map, size: 64, color: Colors.grey),
                        SizedBox(height: 16),
                        Text(
                          'Координаты недоступны',
                          style: TextStyle(color: Colors.grey),
                        ),
                      ],
                    ),
                  ),
          ),
        ),
      ],
    );
  }

  /// Build booking CTA button between map and reviews
  Widget _buildBookingCTA() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 20),
      color: AppTheme.backgroundWarm,
      child: ElevatedButton(
        onPressed: () async {
          final result =
              await BookingBottomSheet.show(context, _establishment!);
          if (result == true && mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text('Запрос на бронирование отправлен!'),
                backgroundColor: AppTheme.statusGreen,
              ),
            );
          }
        },
        style: ElevatedButton.styleFrom(
          backgroundColor: AppTheme.primaryOrange,
          foregroundColor: Colors.white,
          padding: const EdgeInsets.symmetric(vertical: 16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
          ),
          elevation: 0,
        ),
        child: const Text(
          'Хочу забронировать',
          style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
        ),
      ),
    );
  }

  /// Build reviews section (dark background)
  Widget _buildReviewsSection() {
    return Container(
      color: AppTheme.textPrimary,
      padding: const EdgeInsets.symmetric(vertical: 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                Text(
                  'Отзывы',
                  style: TextStyle(
                    fontFamily: AppTheme.fontDisplayFamily,
                    fontSize: 30,
                    fontWeight: FontWeight.w400,
                    color: _backgroundColor,
                  ),
                ),
                const Spacer(),
                // Reviews count with arrow
                GestureDetector(
                  onTap: () {
                    // Navigate to all reviews screen
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (context) => ReviewsListScreen(
                          establishment: _establishment!,
                        ),
                      ),
                    );
                  },
                  child: Row(
                    children: [
                      Text(
                        '$_totalReviews отзывов',
                        style: const TextStyle(
                          fontSize: 14,
                          color: _backgroundColor,
                        ),
                      ),
                      const SizedBox(width: 4),
                      const Icon(
                        Icons.chevron_right,
                        color: _backgroundColor,
                        size: 20,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),

          // Reviews carousel
          if (_reviews.isNotEmpty)
            _buildReviewsCarousel()
          else
            _buildNoReviewsState(),

          const SizedBox(height: 24),

          // Write review button
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: SizedBox(
              width: double.infinity,
              height: 44,
              child: _establishment?.bookingEnabled == true
                  ? OutlinedButton(
                      onPressed: _onWriteReviewTap,
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppTheme.primaryOrange,
                        side: const BorderSide(color: AppTheme.primaryOrange),
                        shape: RoundedRectangleBorder(
                          borderRadius:
                              BorderRadius.circular(AppTheme.radiusSmall),
                        ),
                      ),
                      child: const Text(
                        'Написать отзыв',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    )
                  : ElevatedButton(
                      onPressed: _onWriteReviewTap,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: _secondaryOrange,
                        foregroundColor: _backgroundColor,
                        shape: RoundedRectangleBorder(
                          borderRadius:
                              BorderRadius.circular(AppTheme.radiusSmall),
                        ),
                        elevation: 0,
                      ),
                      child: const Text(
                        'Написать отзыв',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
            ),
          ),
        ],
      ),
    );
  }

  /// Build reviews carousel
  Widget _buildReviewsCarousel() {
    return SizedBox(
      height: 220,
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: _reviews.length,
        itemBuilder: (context, index) {
          return GestureDetector(
            onTap: () {
              // Navigate to all reviews screen when tapping a review card
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (context) => ReviewsListScreen(
                    establishment: _establishment!,
                  ),
                ),
              );
            },
            child: Container(
              width: 348,
              margin:
                  EdgeInsets.only(right: index < _reviews.length - 1 ? 10 : 0),
              child: _buildReviewCard(_reviews[index]),
            ),
          );
        },
      ),
    );
  }

  /// Build review card (Figma style)
  Widget _buildReviewCard(Review review) {
    return Container(
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        border: Border.all(color: _backgroundColor),
        borderRadius: BorderRadius.circular(15),
        boxShadow: [
          BoxShadow(
            color: AppTheme.primaryOrangeShadow.withValues(alpha: 0.04),
            blurRadius: 15,
            spreadRadius: 2,
            offset: const Offset(4, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header row
          Row(
            children: [
              // Avatar
              if (review.fullAvatarUrl != null)
                CircleAvatar(
                  radius: 21,
                  backgroundImage: NetworkImage(review.fullAvatarUrl!),
                  onBackgroundImageError: (_, __) {},
                  backgroundColor: _navyBlue,
                )
              else
                Container(
                  width: 42,
                  height: 42,
                  decoration: const BoxDecoration(
                    color: _navyBlue,
                    shape: BoxShape.circle,
                  ),
                  child: Center(
                    child: Text(
                      review.userName.isNotEmpty
                          ? review.userName[0].toUpperCase()
                          : 'A',
                      style: TextStyle(
                        fontFamily: AppTheme.fontDisplayFamily,
                        fontSize: 25,
                        color: _backgroundColor,
                      ),
                    ),
                  ),
                ),
              const SizedBox(width: 10),
              // Name
              Text(
                review.userName,
                style: const TextStyle(
                  fontSize: 16,
                  color: _backgroundColor,
                ),
              ),
              const Spacer(),
              // Stars and date
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  _buildStarRating(review.rating),
                  const SizedBox(height: 4),
                  Text(
                    _formatDate(review.createdAt),
                    style: TextStyle(
                      fontSize: 12,
                      color: Colors.grey[500],
                    ),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 11),
          // Review text
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    review.text ?? '',
                    style: const TextStyle(
                      fontSize: 12,
                      color: _backgroundColor,
                      height: 1.67,
                    ),
                    maxLines: review.partnerResponse != null ? 3 : 6,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                // Partner response indicator
                if (review.partnerResponse != null &&
                    review.partnerResponse!.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: _primaryOrange.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.reply,
                          size: 12,
                          color: _primaryOrange,
                        ),
                        const SizedBox(width: 4),
                        Flexible(
                          child: Text(
                            'Ответ: ${review.partnerResponse!}',
                            style: TextStyle(
                              fontSize: 10,
                              color: _backgroundColor.withValues(alpha: 0.8),
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Build star rating
  Widget _buildStarRating(int rating) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(5, (index) {
        return Icon(
          index < rating ? Icons.star : Icons.star_border,
          color: index < rating ? _primaryOrange : Colors.grey,
          size: 15,
        );
      }),
    );
  }

  /// Build no reviews state
  Widget _buildNoReviewsState() {
    return const Padding(
      padding: EdgeInsets.symmetric(horizontal: 16),
      child: Text(
        'Пока нет отзывов. Станьте первым!',
        style: TextStyle(
          fontSize: 14,
          color: _backgroundColor,
        ),
      ),
    );
  }

  /// Format date for display
  String _formatDate(DateTime date) {
    final months = [
      'января',
      'февраля',
      'марта',
      'апреля',
      'мая',
      'июня',
      'июля',
      'августа',
      'сентября',
      'октября',
      'ноября',
      'декабря'
    ];
    return '${date.day} ${months[date.month - 1]}';
  }

  /// Open fullscreen gallery for establishment photos
  void _openFullscreenGallery(int initialIndex) {
    final photos = _getSortedPhotos();
    if (photos.isEmpty) return;

    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => _FullscreenGallery(
          photos: photos,
          initialIndex: initialIndex,
        ),
      ),
    );
  }

  /// Open fullscreen gallery for menu photos (images only — PDFs use viewer)
  void _openMenuGallery(int initialIndex) {
    final menuPhotos = (_establishment!.media ?? [])
        .where((m) => m.type == 'menu' && !m.isPdf)
        .toList();
    if (menuPhotos.isEmpty) return;

    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => _FullscreenGallery(
          photos: menuPhotos,
          initialIndex: initialIndex,
        ),
      ),
    );
  }

  /// Open map explorer centered on this establishment (Booking-style exploration)
  void _openMapExplorer() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => MapScreen(
          focusedEstablishment: _establishment,
        ),
      ),
    );
  }

  // ==========================================================================
  // Promotion Banner & Carousel
  // ==========================================================================

  /// Trigger banner below hero — tapping opens promotion carousel
  Widget _buildPromotionBanner() {
    final count = _establishment!.promotions!.length;
    return GestureDetector(
      onTap: () => _showPromotionCarousel(),
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: BoxDecoration(
          color: _primaryOrange.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: _primaryOrange.withValues(alpha: 0.3)),
        ),
        child: Row(
          children: [
            const Text('\u{1F525}', style: TextStyle(fontSize: 18)),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                count == 1
                    ? 'Акция \u00b7 Подробнее \u2192'
                    : '$count акции \u00b7 Подробнее \u2192',
                style: const TextStyle(
                  color: _primaryOrange,
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            const Icon(Icons.arrow_forward_ios,
                size: 14, color: _primaryOrange),
          ],
        ),
      ),
    );
  }

  /// Show promotion carousel as modal bottom sheet
  void _showPromotionCarousel() {
    final promotions = _establishment!.promotions!;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => _PromotionCarouselSheet(
        promotions: promotions,
        establishmentId: _establishment!.id,
        establishmentName: _establishment!.name,
      ),
    );
  }
}

/// Promotion carousel bottom sheet — PageView with indicator dots
class _PromotionCarouselSheet extends StatefulWidget {
  final List<Promotion> promotions;
  final String establishmentId;
  final String establishmentName;

  const _PromotionCarouselSheet({
    required this.promotions,
    required this.establishmentId,
    required this.establishmentName,
  });

  @override
  State<_PromotionCarouselSheet> createState() =>
      _PromotionCarouselSheetState();
}

class _PromotionCarouselSheetState extends State<_PromotionCarouselSheet> {
  int _currentPage = 0;
  final PageController _pageController = PageController();
  final Set<int> _viewedPages = {};

  @override
  void initState() {
    super.initState();
    _trackPromotionView(0);
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  /// Fire-and-forget analytics call (non-blocking)
  void _trackPromotionView(int pageIndex) {
    if (_viewedPages.contains(pageIndex)) return;
    _viewedPages.add(pageIndex);

    ApiClient()
        .post('/api/v1/analytics/promotion-view', data: {
          'establishmentId': widget.establishmentId,
        })
        .then((_) {})
        .catchError((_) => null);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      height: MediaQuery.of(context).size.height * 0.65,
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: Column(
        children: [
          const SizedBox(height: 12),
          Container(
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: AppTheme.strokeGrey,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(height: 8),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  widget.promotions.length == 1 ? 'Акция' : 'Акции',
                  style: AppTheme.canonSheetTitle,
                ),
                IconButton(
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close, size: 24),
                ),
              ],
            ),
          ),
          Expanded(
            child: PageView.builder(
              controller: _pageController,
              itemCount: widget.promotions.length,
              onPageChanged: (index) {
                setState(() => _currentPage = index);
                _trackPromotionView(index);
              },
              itemBuilder: (context, index) =>
                  _buildPromotionSlide(widget.promotions[index]),
            ),
          ),
          if (widget.promotions.length > 1)
            Padding(
              padding: const EdgeInsets.only(bottom: 24, top: 8),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(
                  widget.promotions.length,
                  (i) => Container(
                    width: i == _currentPage ? 12 : 6,
                    height: 6,
                    margin: const EdgeInsets.symmetric(horizontal: 3),
                    decoration: BoxDecoration(
                      color: i == _currentPage
                          ? AppTheme.primaryOrange
                          : AppTheme.strokeGrey,
                      borderRadius: BorderRadius.circular(3),
                    ),
                  ),
                ),
              ),
            )
          else
            const SizedBox(height: 24),
        ],
      ),
    );
  }

  Widget _buildPromotionSlide(Promotion promotion) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: SizedBox(
              height: 200,
              width: double.infinity,
              child: promotion.hasImage
                  ? CachedNetworkImage(
                      imageUrl: promotion.previewUrl ?? promotion.imageUrl!,
                      fit: BoxFit.cover,
                      placeholder: (_, __) => Container(
                        color: Colors.grey[200],
                        child: const Center(
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      ),
                      errorWidget: (_, __, ___) => _buildAutoVisual(promotion),
                    )
                  : _buildAutoVisual(promotion),
            ),
          ),
          const SizedBox(height: 16),
          Text(
            promotion.title,
            style: AppTheme.canonSubsectionHeader,
          ),
          if (promotion.description != null &&
              promotion.description!.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              promotion.description!,
              style: const TextStyle(
                  fontSize: 15, color: AppTheme.textDark, height: 1.4),
            ),
          ],
          if (promotion.validUntil != null) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                const Icon(Icons.schedule, size: 16, color: AppTheme.textGrey),
                const SizedBox(width: 6),
                Text(
                  'до ${_formatDate(promotion.validUntil!)}',
                  style:
                      const TextStyle(fontSize: 13, color: AppTheme.textGrey),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildAutoVisual(Promotion promotion) {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppTheme.primaryOrange, AppTheme.primaryOrangeDark],
        ),
      ),
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                promotion.title,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontFamily: AppTheme.fontDisplayFamily,
                  color: Colors.white,
                  fontSize: 22,
                  fontWeight: FontWeight.w400,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                widget.establishmentName,
                textAlign: TextAlign.center,
                style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.8), fontSize: 14),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _formatDate(DateTime date) {
    return '${date.day.toString().padLeft(2, '0')}.${date.month.toString().padLeft(2, '0')}.${date.year}';
  }
}

/// Working hours row widget
class _WorkingHoursRow extends StatelessWidget {
  final String label;
  final String time;
  final bool isHighlighted;

  const _WorkingHoursRow({
    required this.label,
    required this.time,
    this.isHighlighted = false,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        children: [
          SizedBox(
            width: 180,
            child: Text(
              label,
              style: TextStyle(
                fontSize: 16,
                fontWeight: isHighlighted ? FontWeight.w700 : FontWeight.w500,
                color: isHighlighted
                    ? AppTheme.primaryOrange
                    : AppTheme.textPrimary,
              ),
            ),
          ),
          Text(
            time,
            style: TextStyle(
              fontSize: 16,
              fontWeight: isHighlighted ? FontWeight.w600 : FontWeight.w400,
              color:
                  isHighlighted ? AppTheme.primaryOrange : AppTheme.textPrimary,
            ),
          ),
        ],
      ),
    );
  }
}

/// Extracted mini-map widget that manages its own YandexMapController.
/// Prevents parent setState() from rebuilding the native map view, which
/// would reset camera to default Eurasia zoom on iOS.
class _EstablishmentMiniMap extends StatefulWidget {
  final double latitude;
  final double longitude;
  final bool isOpen;

  const _EstablishmentMiniMap({
    required this.latitude,
    required this.longitude,
    required this.isOpen,
  });

  @override
  State<_EstablishmentMiniMap> createState() => _EstablishmentMiniMapState();
}

class _EstablishmentMiniMapState extends State<_EstablishmentMiniMap> {
  final MapMarkerGenerator _markerGenerator = MapMarkerGenerator();

  /// Gate flag: prevents duplicate positioning if onMapCreated fires again.
  /// Also mirrors the pattern from map_screen.dart (lines 53-56, 358-374).
  bool _mapReady = false;

  @override
  void initState() {
    super.initState();
    _initMarkers();
  }

  Future<void> _initMarkers() async {
    final dpr =
        WidgetsBinding.instance.platformDispatcher.views.first.devicePixelRatio;
    await _markerGenerator.ensureInitialized(dpr);
    if (mounted) setState(() {});
  }

  /// Position camera with immediate + delayed retry for iOS.
  /// Sets _mapReady = true when complete to prevent duplicate calls.
  Future<void> _positionMap(YandexMapController controller) async {
    if (_mapReady) return;

    final cameraPosition = CameraPosition(
      target: Point(
        latitude: widget.latitude,
        longitude: widget.longitude,
      ),
      zoom: 16.0,
    );

    // Attempt 1: immediate (works when tile cache is warm)
    await controller.moveCamera(
      CameraUpdate.newCameraPosition(cameraPosition),
    );

    // Attempt 2: after native view is reliably ready
    await Future.delayed(const Duration(milliseconds: 250));
    if (!mounted) return;
    await controller.moveCamera(
      CameraUpdate.newCameraPosition(cameraPosition),
    );

    _mapReady = true;
  }

  @override
  Widget build(BuildContext context) {
    return AbsorbPointer(
      // Prevent map gestures, only allow tap on parent GestureDetector
      child: YandexMap(
        onMapCreated: (YandexMapController controller) {
          _positionMap(controller);
        },
        mapObjects: [
          PlacemarkMapObject(
            mapId: const MapObjectId('establishment_marker'),
            point: Point(
              latitude: widget.latitude,
              longitude: widget.longitude,
            ),
            icon: _markerGenerator.getMarkerImage(isOpen: widget.isOpen) != null
                ? PlacemarkIcon.single(
                    PlacemarkIconStyle(
                      image: BitmapDescriptor.fromBytes(_markerGenerator
                          .getMarkerImage(isOpen: widget.isOpen)!),
                      scale: 1.0,
                    ),
                  )
                : PlacemarkIcon.single(
                    PlacemarkIconStyle(
                      image: BitmapDescriptor.fromAssetImage(
                          'packages/yandex_mapkit/assets/place.png'),
                      scale: 2.0,
                    ),
                  ),
            opacity: 1.0,
          ),
        ],
      ),
    );
  }
}

/// Fullscreen gallery screen
class _FullscreenGallery extends StatefulWidget {
  final List<EstablishmentMedia> photos;
  final int initialIndex;

  const _FullscreenGallery({
    required this.photos,
    required this.initialIndex,
  });

  @override
  State<_FullscreenGallery> createState() => _FullscreenGalleryState();
}

class _FullscreenGalleryState extends State<_FullscreenGallery> {
  late PageController _pageController;
  late int _currentIndex;

  @override
  void initState() {
    super.initState();
    _currentIndex = widget.initialIndex;
    _pageController = PageController(initialPage: widget.initialIndex);
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        fit: StackFit.expand,
        children: [
          // Photos
          PageView.builder(
            controller: _pageController,
            itemCount: widget.photos.length,
            onPageChanged: (index) {
              setState(() => _currentIndex = index);
            },
            itemBuilder: (context, index) {
              final photo = widget.photos[index];
              final imageUrl =
                  photo.url ?? photo.previewUrl ?? photo.thumbnailUrl;

              if (imageUrl == null) {
                return const Center(
                  child: Icon(Icons.error,
                      color: AppTheme.textOnPrimary, size: 48),
                );
              }

              return InteractiveViewer(
                minScale: 0.5,
                maxScale: 4.0,
                child: CachedNetworkImage(
                  imageUrl: imageUrl,
                  fit: BoxFit.contain,
                  placeholder: (context, url) => const Center(
                    child: CircularProgressIndicator(
                        color: AppTheme.textOnPrimary),
                  ),
                  errorWidget: (context, url, error) => const Center(
                    child: Icon(Icons.error,
                        color: AppTheme.textOnPrimary, size: 48),
                  ),
                ),
              );
            },
          ),

          // Close button
          Positioned(
            top: MediaQuery.of(context).padding.top + 8,
            right: 16,
            child: IconButton(
              icon: const Icon(Icons.close,
                  color: AppTheme.textOnPrimary, size: 28),
              onPressed: () => Navigator.of(context).pop(),
            ),
          ),

          // Counter
          Positioned(
            bottom: MediaQuery.of(context).padding.bottom + 16,
            left: 0,
            right: 0,
            child: Center(
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: Colors.black.withValues(alpha: 0.6),
                  borderRadius: BorderRadius.circular(AppTheme.radiusLarge),
                ),
                child: Text(
                  '${_currentIndex + 1} / ${widget.photos.length}',
                  style: const TextStyle(
                    color: AppTheme.textOnPrimary,
                    fontSize: 14,
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

/// PDF menu card on establishment detail screen
///
/// Shows Cloudinary first-page thumbnail + filename/caption + "Открыть PDF →"
/// affordance. Tap opens embedded pdfx viewer.
class _PdfMenuCard extends StatelessWidget {
  final EstablishmentMedia pdf;
  final VoidCallback onTap;

  const _PdfMenuCard({required this.pdf, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final title = pdf.caption ?? 'Меню';
    final thumbUrl = pdf.thumbnailUrl ?? pdf.previewUrl ?? pdf.url;

    return GestureDetector(
      onTap: onTap,
      child: Container(
        height: 100,
        decoration: BoxDecoration(
          color: AppTheme.backgroundPrimary,
          borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
          border: Border.all(color: AppTheme.strokeGrey),
          boxShadow: [
            BoxShadow(
              color: AppTheme.primaryOrangeShadow.withValues(alpha: 0.04),
              blurRadius: 12,
              spreadRadius: 1,
              offset: const Offset(2, 2),
            ),
          ],
        ),
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            // First page thumbnail
            ClipRRect(
              borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
              child: thumbUrl != null
                  ? CachedNetworkImage(
                      imageUrl: thumbUrl,
                      width: 76,
                      height: 76,
                      fit: BoxFit.cover,
                      placeholder: (_, __) => Container(
                        width: 76,
                        height: 76,
                        color: Colors.grey[200],
                      ),
                      errorWidget: (_, __, ___) => Container(
                        width: 76,
                        height: 76,
                        color: Colors.grey[200],
                        child: const Icon(
                          Icons.picture_as_pdf,
                          color: AppTheme.primaryOrange,
                        ),
                      ),
                    )
                  : Container(
                      width: 76,
                      height: 76,
                      color: Colors.grey[200],
                      child: const Icon(
                        Icons.picture_as_pdf,
                        color: AppTheme.primaryOrange,
                      ),
                    ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w500,
                      color: AppTheme.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 4),
                  const Row(
                    children: [
                      Text(
                        'Открыть PDF',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w500,
                          color: AppTheme.primaryOrange,
                        ),
                      ),
                      SizedBox(width: 4),
                      Icon(
                        Icons.arrow_forward,
                        size: 16,
                        color: AppTheme.primaryOrange,
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Small label separating "Фото меню" subsection when both PDFs and
/// photos are present in the menu block.
class _MenuSubsectionLabel extends StatelessWidget {
  final String label;

  const _MenuSubsectionLabel({required this.label});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const Expanded(child: Divider(color: AppTheme.strokeGrey, height: 1)),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Text(
            label,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w500,
              color: AppTheme.textGrey,
            ),
          ),
        ),
        const Expanded(child: Divider(color: AppTheme.strokeGrey, height: 1)),
      ],
    );
  }
}
