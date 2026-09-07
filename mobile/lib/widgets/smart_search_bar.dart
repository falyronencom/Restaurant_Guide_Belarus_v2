import 'dart:async';
import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';

/// Animated placeholder hints that cycle every 3 seconds
const _placeholderHints = [
  'С чего начнём?',
  'кофе рядом',
  'суши на вынос',
  'где позавтракать',
  'уютное кафе',
];

/// Refactored search bar with animated placeholder.
/// Extracted from SearchHomeScreen._buildSearchBar().
class SmartSearchBar extends StatefulWidget {
  final TextEditingController controller;
  final VoidCallback onSubmit;
  final VoidCallback onChevronTap;
  final ValueChanged<bool>? onFocusChanged;

  const SmartSearchBar({
    super.key,
    required this.controller,
    required this.onSubmit,
    required this.onChevronTap,
    this.onFocusChanged,
  });

  @override
  State<SmartSearchBar> createState() => _SmartSearchBarState();
}

class _SmartSearchBarState extends State<SmartSearchBar> {
  static const Color _primaryOrange = AppTheme.primaryOrange;
  static const Color _greyText = AppTheme.textGrey;

  final FocusNode _focusNode = FocusNode();
  Timer? _hintTimer;
  int _currentHintIndex = 0;
  bool _isFocused = false;

  @override
  void initState() {
    super.initState();
    _focusNode.addListener(_onFocusChange);
    _startHintCycle();
  }

  @override
  void dispose() {
    _hintTimer?.cancel();
    _focusNode.removeListener(_onFocusChange);
    _focusNode.dispose();
    super.dispose();
  }

  void _onFocusChange() {
    setState(() => _isFocused = _focusNode.hasFocus);
    widget.onFocusChanged?.call(_focusNode.hasFocus);
    if (_focusNode.hasFocus) {
      _hintTimer?.cancel();
    } else if (widget.controller.text.isEmpty) {
      _startHintCycle();
    }
  }

  void _startHintCycle() {
    _hintTimer?.cancel();
    _hintTimer = Timer.periodic(const Duration(seconds: 3), (_) {
      if (!mounted || _isFocused) return;
      setState(() {
        _currentHintIndex = (_currentHintIndex + 1) % _placeholderHints.length;
      });
    });
  }

  void _handleSubmit() {
    if (widget.controller.text.trim().isNotEmpty) {
      widget.onSubmit();
    } else {
      widget.onChevronTap();
    }
  }

  @override
  Widget build(BuildContext context) {
    final hasText = widget.controller.text.trim().isNotEmpty;

    // Determine hint text: animated cycling when idle, prompt when focused
    final hintText = _isFocused
        ? 'Введите запрос...'
        : _placeholderHints[_currentHintIndex];

    return Row(
      children: [
        // Search input field
        Expanded(
          child: Container(
            height: 64,
            decoration: const BoxDecoration(
              color: Color(0xFFF5F5F5),
              borderRadius: BorderRadius.only(
                topLeft: Radius.circular(9),
                bottomLeft: Radius.circular(9),
              ),
            ),
            child: TextField(
              controller: widget.controller,
              focusNode: _focusNode,
              style: const TextStyle(
                fontSize: 18,
                color: AppTheme.textPrimary,
              ),
              decoration: InputDecoration(
                hintText: hintText,
                hintStyle: const TextStyle(
                  fontSize: 18,
                  color: _greyText,
                  fontWeight: FontWeight.w400,
                ),
                border: InputBorder.none,
                // Поле само рисует свою форму (Container). Гасим рамку и заливку
                // из глобальной inputDecorationTheme — иначе на фокусе всплывает
                // оранжевая обводка со скруглением всех углов и зазоры у кнопки.
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                errorBorder: InputBorder.none,
                focusedErrorBorder: InputBorder.none,
                filled: false,
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 20,
                ),
              ),
              // Клавиша клавиатуры и оранжевая кнопка — одно действие.
              // Раньше клавиша только прятала клавиатуру: пользователь нажимал
              // «Найти» и не получал ничего. / The keyboard key and the button
              // do the same thing; the key used to only dismiss the keyboard.
              textInputAction: TextInputAction.search,
              onSubmitted: (_) {
                _focusNode.unfocus();
                _handleSubmit();
              },
              onChanged: (_) => setState(() {}),
            ),
          ),
        ),
        // Search/chevron button
        GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: _handleSubmit,
          child: Container(
            width: 64,
            height: 64,
            decoration: const BoxDecoration(
              color: _primaryOrange,
              borderRadius: BorderRadius.only(
                topRight: Radius.circular(9),
                bottomRight: Radius.circular(9),
              ),
            ),
            child: Center(
              child: Icon(
                hasText ? Icons.search : Icons.chevron_right,
                color: AppTheme.textOnPrimary,
                size: 30,
              ),
            ),
          ),
        ),
      ],
    );
  }
}
