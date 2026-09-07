import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';

import '../support/wire_fixtures.dart';

/// Контракт провода для карточки заведения.
///
/// Серверную сторону этого контракта держат 238 тестов бэкенда: они проверяют,
/// что проекция отдаёт нужные поля. Клиентскую сторону не проверял никто —
/// а именно она ломается молча и без пересборки. Приложение на устройстве
/// пользователя до запуска не обновляется; изменение проекции доезжает до
/// него в тот же день, и единственный способ узнать об этом заранее —
/// сломать здесь.
void main() {
  group('Строка проекции разбирается целиком', () {
    test('все поля списка доходят до модели', () {
      final e = Establishment.fromJson(establishmentRow());

      expect(e.id, '11111111-1111-4111-8111-111111111111');
      expect(e.name, 'Васильки');
      expect(e.city, 'Минск');
      expect(e.address, 'пр. Независимости, 43');
      expect(e.status, 'active');
      expect(e.latitude, 53.9023);
      expect(e.longitude, 27.5619);
      expect(e.priceRange, r'$$');
      expect(e.rating, 4.5);
      expect(e.bookingEnabled, isTrue);
      expect(e.hasPromotion, isFalse);
      expect(e.createdAt, DateTime.utc(2026, 4, 1, 9));
      expect(e.updatedAt, DateTime.utc(2026, 6, 1, 9));
    });
  });

  group('Обязательные поля провода', () {
    // Шесть полей, без которых `fromJson` не работает. Проверяем НЕ то, что
    // разбор бросает исключение — бросок это сегодняшняя реализация, и
    // терпимость к пропаже была бы улучшением. Проверяем, что разбор не
    // выдаёт карточку с ПОДСТАВНЫМ значением: молчаливая подмена ровно того
    // рода, что 07.09 дорисовывала заведению Wi-Fi, которого у него нет.
    const loadBearing = <String>[
      'name',
      'address',
      'city',
      'status',
      'created_at',
      'updated_at',
    ];

    for (final key in loadBearing) {
      test('без «$key» карточка не собирается из подставных значений', () {
        Establishment? parsed;
        try {
          parsed = Establishment.fromJson(without(establishmentRow(), key));
        } catch (_) {
          parsed = null;
        }
        expect(
          parsed,
          isNull,
          reason: 'поле «$key» пропало из проекции, а карточка всё равно '
              'собралась — значит вместо него подставлено выдуманное значение, '
              'и гость увидит его как факт',
        );
      });
    }

    test('переименование поля ловится так же, как пропажа', () {
      // Отличие от пропажи: значение в ответе ОСТАЛОСЬ, просто под другим
      // именем. Код, который смотрит «есть ли вообще данные», это пропустит.
      Establishment? parsed;
      try {
        parsed = Establishment.fromJson(
          renamed(establishmentRow(), 'name', 'title'),
        );
      } catch (_) {
        parsed = null;
      }
      expect(parsed, isNull);
    });
  });

  group('Терпимость к необязательным полям', () {
    test('карточка без описания, телефона, сайта и координат разбирается', () {
      var row = establishmentRow();
      for (final key in ['description', 'phone', 'website', 'latitude',
        'longitude', 'price_range', 'attributes', 'working_hours']) {
        row = without(row, key);
      }

      final e = Establishment.fromJson(row);

      expect(e.name, 'Васильки');
      expect(e.description, isNull);
      expect(e.phone, isNull);
      expect(e.website, isNull);
      expect(e.latitude, isNull);
      expect(e.longitude, isNull);
      expect(e.priceRange, isNull);
      expect(e.attributes, isNull);
      expect(e.workingHours, isNull);
    });
  });

  group('Числа с провода', () {
    test('рейтинг приходит числом', () {
      final e = Establishment.fromJson(establishmentRow());
      expect(e.rating, 4.5);
    });

    test('рейтинг приходит строкой NUMERIC и всё равно разбирается', () {
      // NUMERIC вне явного каста node-pg отдаёт строкой. Проекция сейчас
      // кастует сама, но `average_rating` приходит и из ответов, которые
      // через проекцию не идут. Разбор обязан пережить обе формы.
      final row = establishmentRow();
      row['average_rating'] = '4.30';

      final e = Establishment.fromJson(row);
      expect(e.rating, 4.3);
    });

    test('рейтинга нет — null, а не ноль', () {
      // Ноль и «оценок пока нет» — разные вещи: ноль рисуется как худшая
      // возможная оценка.
      final row = without(establishmentRow(), 'average_rating');
      expect(Establishment.fromJson(row).rating, isNull);
    });

    test('расстояние приходит строкой и разбирается', () {
      final row = establishmentRow();
      row['distance'] = '1.75';
      expect(Establishment.fromJson(row).distance, 1.75);
    });

    test('нечисловое расстояние даёт null, а не исключение', () {
      final row = establishmentRow();
      row['distance'] = 'далеко';
      expect(Establishment.fromJson(row).distance, isNull);
    });

    test('promotion_count отсутствует — ноль', () {
      final row = without(establishmentRow(), 'promotion_count');
      expect(Establishment.fromJson(row).promotionCount, 0);
    });
  });

  group('Флаги', () {
    test('booking_enabled и has_promotion читаются как есть', () {
      final row = establishmentRow();
      row['booking_enabled'] = true;
      row['has_promotion'] = true;

      final e = Establishment.fromJson(row);
      expect(e.bookingEnabled, isTrue);
      expect(e.hasPromotion, isTrue);
    });

    test('отсутствующий флаг выключен, а не включён', () {
      // Направление важно: включённый по умолчанию `booking_enabled` показал
      // бы гостю кнопку брони у заведения, которое брони не принимает.
      var row = without(establishmentRow(), 'booking_enabled');
      row = without(row, 'has_promotion');

      final e = Establishment.fromJson(row);
      expect(e.bookingEnabled, isFalse);
      expect(e.hasPromotion, isFalse);
    });
  });

  group('Картинка карточки', () {
    test('в списке приходит только primary_image_url — картинка есть', () {
      // Проекция списка НЕ несёт `thumbnail_url`; если убрать запасной
      // вариант, карточки останутся без единой картинки, и это будет
      // выглядеть как «фото ещё не загрузили», а не как поломка.
      final row = without(establishmentRow(), 'thumbnail_url');
      expect(
        Establishment.fromJson(row).thumbnailUrl,
        'https://cdn.example/vasilki',
      );
    });

    test('явный thumbnail_url важнее primary_image_url', () {
      final row = establishmentRow();
      row['thumbnail_url'] = 'https://cdn.example/thumb-explicit';
      expect(
        Establishment.fromJson(row).thumbnailUrl,
        'https://cdn.example/thumb-explicit',
      );
    });
  });

  group('Категории и кухни', () {
    test('кириллица канона проходит без изменений', () {
      final e = Establishment.fromJson(establishmentRow(
        categories: ['Кальянная', 'Бар'],
        cuisines: ['Грузинская'],
      ));

      expect(e.categories, ['Кальянная', 'Бар']);
      expect(e.cuisines, ['Грузинская']);
    });

    test('первая категория и первая кухня становятся основными', () {
      final e = Establishment.fromJson(establishmentRow(
        categories: ['Бар', 'Кальянная'],
        cuisines: ['Японская', 'Азиатская'],
      ));

      expect(e.category, 'Бар');
      expect(e.cuisine, 'Японская');
    });

    test('латиница из легаси-данных нормализуется в кириллицу', () {
      // Две пары различаются только этим отображением: `cafe` — кофейня, а
      // `cafe_dining` — кафе. Перепутать их местами значит показать гостю
      // не тот тип заведения.
      final e = Establishment.fromJson(establishmentRow(
        categories: ['cafe', 'cafe_dining', 'hookah_bar'],
        cuisines: ['belarusian', 'fusion'],
      ));

      expect(e.categories, ['Кофейня', 'Кафе', 'Кальянная']);
      expect(e.cuisines, ['Народная', 'Авторская']);
    });

    test('неизвестное значение остаётся как пришло, а не теряется', () {
      final e = Establishment.fromJson(establishmentRow(
        categories: ['Веранда'],
      ));
      expect(e.categories, ['Веранда']);
    });
  });

  group('Медиа заведения', () {
    test('file_type отсутствует — считаем картинкой', () {
      final m = EstablishmentMedia.fromJson(mediaRow());
      expect(m.fileType, 'image');
      expect(m.isPdf, isFalse);
    });

    test('pdf распознаётся как pdf', () {
      final m = EstablishmentMedia.fromJson(
        mediaRow(type: 'menu', fileType: 'pdf'),
      );
      expect(m.isPdf, isTrue);
      expect(m.type, 'menu');
    });

    test('медиа заведения разбирается вместе с карточкой', () {
      final e = Establishment.fromJson(establishmentRow(
        media: [mediaRow(position: 0), mediaRow(id: 'x', position: 1)],
      ));

      expect(e.media, hasLength(2));
      expect(e.media!.first.position, 0);
      expect(e.media!.last.id, 'x');
    });
  });

  group('Разбор часов работы', () {
    test('строка «10:00-22:00» раскладывается на открытие и закрытие', () {
      expect(
        Establishment.parseDayHours('10:00-22:00'),
        {'open': '10:00', 'close': '22:00', 'is_open': true},
      );
    });

    test('пробелы вокруг тире не мешают', () {
      expect(
        Establishment.parseDayHours(' 10:00 - 22:00 '),
        {'open': '10:00', 'close': '22:00', 'is_open': true},
      );
    });

    test('объектная форма читается', () {
      expect(
        Establishment.parseDayHours({'open': '09:00', 'close': '18:00'}),
        {'open': '09:00', 'close': '18:00', 'is_open': true},
      );
    });

    test('выходной день объявлен явно', () {
      expect(
        Establishment.parseDayHours({'is_open': false}),
        {'is_open': false},
      );
    });

    test('дня нет в расписании — null', () {
      expect(Establishment.parseDayHours(null), isNull);
    });
  });

  group('Открыто или закрыто в конкретный момент', () {
    // Понедельник, 2026-09-07. День недели берётся из момента, поэтому все
    // ожидания ниже не зависят от часов машины, на которой идёт прогон.
    Map<String, dynamic> hours(String monday) => {'monday': monday};

    test('до открытия закрыто', () {
      final e = Establishment.fromJson(
        establishmentRow(workingHours: hours('10:00-22:00')),
      );
      expect(e.isOpenAt(DateTime(2026, 9, 7, 9, 59)), isFalse);
    });

    test('в минуту открытия уже открыто', () {
      final e = Establishment.fromJson(
        establishmentRow(workingHours: hours('10:00-22:00')),
      );
      expect(e.isOpenAt(DateTime(2026, 9, 7, 10, 0)), isTrue);
    });

    test('в минуту закрытия уже закрыто', () {
      // Граница исключающая: в 22:00 заведение закрыто, а не «ещё открыто».
      final e = Establishment.fromJson(
        establishmentRow(workingHours: hours('10:00-22:00')),
      );
      expect(e.isOpenAt(DateTime(2026, 9, 7, 21, 59)), isTrue);
      expect(e.isOpenAt(DateTime(2026, 9, 7, 22, 0)), isFalse);
    });

    test('окно через полночь: вечер открыт, ночь открыта, утро закрыто', () {
      // Бар 18:00–02:00. Ветка, ради которой всё выносилось: время закрытия
      // меньше времени открытия, и обычное сравнение даёт «закрыто всегда».
      final e = Establishment.fromJson(
        establishmentRow(workingHours: hours('18:00-02:00')),
      );

      expect(e.isOpenAt(DateTime(2026, 9, 7, 23, 30)), isTrue,
          reason: 'вечер того же дня');
      expect(e.isOpenAt(DateTime(2026, 9, 7, 0, 30)), isTrue,
          reason: 'ночь до закрытия');
      expect(e.isOpenAt(DateTime(2026, 9, 7, 3, 0)), isFalse,
          reason: 'после закрытия');
      expect(e.isOpenAt(DateTime(2026, 9, 7, 17, 59)), isFalse,
          reason: 'до открытия');
      // Границы у ночного окна — своя ветка кода, и её надо трогать отдельно:
      // мутация «сделать открытие исключающим» пережила проверку границ
      // дневного окна, потому что дневное окно считается другим выражением.
      expect(e.isOpenAt(DateTime(2026, 9, 7, 18, 0)), isTrue,
          reason: 'ровно в минуту открытия ночного окна');
      expect(e.isOpenAt(DateTime(2026, 9, 7, 1, 59)), isTrue,
          reason: 'последняя минута перед закрытием ночного окна');
      expect(e.isOpenAt(DateTime(2026, 9, 7, 2, 0)), isFalse,
          reason: 'минута закрытия ночного окна — уже закрыто');
    });

    test('в выходной день закрыто в любой час', () {
      final e = Establishment.fromJson(
        establishmentRow(workingHours: {'monday': {'is_open': false}}),
      );
      expect(e.isOpenAt(DateTime(2026, 9, 7, 13, 0)), isFalse);
    });

    test('день недели берётся из момента, а не из расписания соседнего дня',
        () {
      // Вторник открыт, понедельник выходной. Если код возьмёт не тот день,
      // подпись «Открыто» появится в выходной.
      final e = Establishment.fromJson(establishmentRow(workingHours: {
        'monday': {'is_open': false},
        'tuesday': '10:00-22:00',
      }));

      expect(e.isOpenAt(DateTime(2026, 9, 7, 13, 0)), isFalse,
          reason: 'понедельник');
      expect(e.isOpenAt(DateTime(2026, 9, 8, 13, 0)), isTrue,
          reason: 'вторник');
    });

    test('расписания нет вовсе — падаем на статус заведения', () {
      final active = Establishment.fromJson(
        without(establishmentRow(), 'working_hours'),
      );
      expect(active.isOpenAt(DateTime(2026, 9, 7, 3, 0)), isTrue);

      final suspended = Establishment.fromJson(
        without(establishmentRow(status: 'suspended'), 'working_hours'),
      );
      expect(suspended.isOpenAt(DateTime(2026, 9, 7, 13, 0)), isFalse);
    });

    test('время закрытия показывается только в рабочий день', () {
      final e = Establishment.fromJson(establishmentRow(workingHours: {
        'monday': '10:00-22:00',
        'tuesday': {'is_open': false},
      }));

      expect(e.closingTimeAt(DateTime(2026, 9, 7, 13, 0)), '22:00');
      expect(e.closingTimeAt(DateTime(2026, 9, 8, 13, 0)), isNull);
    });

    test('ГРАНИЦА: выходной без времени закрытия защищён дважды', () {
      // Честная граница этого файла. `closingTimeAt` проверяет `is_open`
      // отдельно, но проверка недостижима: `parseDayHours` для выходного
      // возвращает `{'is_open': false}` вообще без ключа `close`, поэтому
      // снятие внутренней проверки ничего не меняет — мутация её переживает.
      // Утверждение ниже верно и нужно, но сторожит оно `parseDayHours`, а не
      // `closingTimeAt`; отличить их данными нельзя, пока форма выходного дня
      // такая. Записано в отчёт как мёртвая проверка, а не как покрытие.
      expect(Establishment.parseDayHours({'is_open': false, 'close': '22:00'}),
          {'is_open': false},
          reason: 'разбор сам роняет время закрытия у выходного дня');
    });
  });
}
