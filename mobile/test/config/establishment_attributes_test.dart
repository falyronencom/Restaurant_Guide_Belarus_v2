import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/config/establishment_attributes.dart';

/// Тесты на атрибуты гостевой карточки.
///
/// Главный из них — первый: при пустых `attributes` список обязан остаться
/// пустым. До 07.09.2026 экран детали в этом случае подставлял «Доставка еды ·
/// Wi-Fi · Терасса» и показывал их как факт. Каталог на старте набивается
/// вручную, пустые `attributes` — обычное дело, так что неправду видел бы
/// заметный процент карточек.
void main() {
  group('EstablishmentAttributes.active', () {
    test('пустые attributes НЕ дорисовываются значениями по умолчанию', () {
      expect(EstablishmentAttributes.active(null), isEmpty);
      expect(EstablishmentAttributes.active(<String, dynamic>{}), isEmpty);
    });

    test('атрибуты со значением false не показываются', () {
      final result = EstablishmentAttributes.active({
        'delivery': false,
        'wifi': false,
        'terrace': false,
      });
      expect(result, isEmpty);
    });

    test('показываются только те, что действительно true', () {
      final result = EstablishmentAttributes.active({
        'wifi': true,
        'delivery': false,
        'parking': true,
      });
      expect(result.map((a) => a['name']), ['Wi-Fi', 'Парковка']);
    });

    test('порядок канонический, а не порядок ключей в ответе', () {
      // Ключи намеренно поданы в обратном порядке: если реализация пойдёт по
      // ключам ответа, а не по своей таблице, порядок на карточке будет
      // зависеть от сериализации JSON на бэкенде.
      final result = EstablishmentAttributes.active({
        'smoking': true,
        'banquet': true,
        'delivery': true,
      });
      expect(result.map((a) => a['name']), ['Доставка еды', 'Банкет', 'Курение']);
    });

    test('неизвестный ключ игнорируется, а не рисуется', () {
      final result = EstablishmentAttributes.active({
        'karaoke': true, // не входит в канон бэкенда
        'wifi': true,
      });
      expect(result.map((a) => a['name']), ['Wi-Fi']);
    });

    test('строка "true" не считается истиной', () {
      // JSONB хранит булев тип; строка означала бы порчу данных, и рисовать
      // атрибут по ней нельзя.
      expect(EstablishmentAttributes.active({'wifi': 'true'}), isEmpty);
    });

    test('у каждого атрибута канона есть файл иконки в assets/icons', () {
      // Имя файла собирается как assets/icons/<svg>.svg в _buildAmenityItem.
      // Список ниже — состав каталога на 07.09.2026; сторож ловит выпадение
      // иконки при переименовании, которое иначе видно только глазами.
      const shipped = <String>{
        'Доставка еды', 'Wifi', 'Терасса', 'Парковка', 'Живая музыка',
        'Детская зона', 'Банкет', 'Животные', 'Курение',
      };
      for (final item in EstablishmentAttributes.canon) {
        expect(shipped, contains(item['svg']),
            reason: 'нет иконки для ${item['key']}');
      }
    });
  });
}
