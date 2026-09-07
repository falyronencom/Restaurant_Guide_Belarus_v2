import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';

/// Строка поиска экрана результатов (макет Figma: стрелка «назад» внутри поля).
///
/// Экран рисует её дважды — в развёрнутой шапке и в свёрнутой при прокрутке.
/// Копии обязаны совпадать: пока они жили порознь, у одной из них не было
/// кнопки поиска вовсе, а клавиша клавиатуры была единственным способом
/// запустить запрос. Один виджет — одна правка и одна проверка. / The screen
/// renders this bar twice (expanded and collapsed header); keeping the two in
/// sync by hand is what let the search button go missing from one of them.
///
/// Оранжевый блок с главной сюда не переносится намеренно: слева в поле уже
/// стоит стрелка «назад», и второй крупный блок сломал бы макет. Лупа справа
/// даёт то же действие.
class ResultsSearchBar extends StatelessWidget {
  const ResultsSearchBar({
    super.key,
    required this.controller,
    required this.onBack,
    required this.onSubmit,
  });

  final TextEditingController controller;

  /// Стрелка внутри поля — возврат на предыдущий экран
  final VoidCallback onBack;

  /// Лупа и клавиша клавиатуры — одно и то же действие
  final VoidCallback onSubmit;

  static const Color _greyText = AppTheme.textGrey;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 64,
      decoration: BoxDecoration(
        color: const Color(0xFFF5F5F5),
        borderRadius: BorderRadius.circular(9),
      ),
      child: TextField(
        controller: controller,
        style: const TextStyle(
          fontSize: 18,
          color: AppTheme.textPrimary,
        ),
        decoration: InputDecoration(
          hintText: 'С чего начнем?',
          hintStyle: const TextStyle(
            fontSize: 18,
            color: _greyText,
            fontWeight: FontWeight.w400,
          ),
          border: InputBorder.none,
          // Поле само рисует свою форму (Container). Гасим рамку и заливку из
          // глобальной inputDecorationTheme — иначе на фокусе всплывает
          // оранжевая обводка со скруглением всех углов.
          enabledBorder: InputBorder.none,
          focusedBorder: InputBorder.none,
          errorBorder: InputBorder.none,
          focusedErrorBorder: InputBorder.none,
          filled: false,
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 16,
            vertical: 20,
          ),
          prefixIcon: GestureDetector(
            onTap: onBack,
            child: const Icon(
              Icons.chevron_left,
              color: AppTheme.textPrimary,
              size: 25,
            ),
          ),
          prefixIconConstraints: const BoxConstraints(
            minWidth: 44,
            minHeight: 64,
          ),
          suffixIcon: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: onSubmit,
            child: const Icon(
              Icons.search,
              color: AppTheme.textPrimary,
              size: 25,
            ),
          ),
          suffixIconConstraints: const BoxConstraints(
            minWidth: 44,
            minHeight: 64,
          ),
        ),
        textInputAction: TextInputAction.search,
        onSubmitted: (_) => onSubmit(),
      ),
    );
  }
}
