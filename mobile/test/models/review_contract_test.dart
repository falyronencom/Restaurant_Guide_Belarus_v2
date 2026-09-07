import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/models/review.dart';

import '../support/wire_fixtures.dart';

/// Контракт провода для отзывов.
///
/// Отзывы — та поверхность, где молчаливый отказ дороже всего: список
/// подставляет «Аноним» вместо имени, а пустая страница выглядит как «отзывов
/// пока нет», а не как поломка. Ни одно из этих состояний не отличимо от
/// правды ни для гостя, ни для нас.
void main() {
  group('Отзыв: вложенный автор', () {
    test('строка публичного списка разбирается целиком', () {
      final r = Review.fromJson(reviewRow());

      expect(r.id, '33333333-3333-4333-8333-333333333333');
      expect(r.userName, 'Ирина');
      expect(r.userId, '44444444-4444-4444-8444-444444444444');
      expect(r.rating, 5);
      expect(r.text, 'Драники как у бабушки');
      expect(r.createdAt, DateTime.utc(2026, 6, 10, 18, 30));
    });

    test('имя автора не подменяется «Анонимом», когда автор есть', () {
      // Подстановка «Аноним» законна для отзыва без автора и недопустима как
      // тихий ответ на переименование поля: весь список станет анонимным, и
      // никто не поймёт, что это поломка.
      final r = Review.fromJson(reviewRow(authorName: 'Пётр'));
      expect(r.userName, 'Пётр');
    });

    test('автор без имени — «Аноним», а не пустая строка', () {
      final row = reviewRow();
      (row['author'] as Map<String, dynamic>).remove('name');
      expect(Review.fromJson(row).userName, 'Аноним');
    });

    test('относительный путь к аватару достраивается до абсолютного', () {
      final r = Review.fromJson(reviewRow());
      expect(r.userAvatar, '/uploads/avatars/irina.jpg');
      expect(r.fullAvatarUrl, endsWith('/uploads/avatars/irina.jpg'));
      expect(r.fullAvatarUrl, startsWith('http'));
    });

    test('абсолютный адрес аватара не достраивается второй раз', () {
      final row = reviewRow();
      (row['author'] as Map<String, dynamic>)['avatar_url'] =
          'https://cdn.example/irina.jpg';
      expect(
        Review.fromJson(row).fullAvatarUrl,
        'https://cdn.example/irina.jpg',
      );
    });
  });

  group('Отзыв: плоская форма', () {
    test('author_name читается, когда вложенного автора нет', () {
      final row = without(reviewRow(), 'author');
      row['author_name'] = 'Сергей';
      row['author_avatar'] = '/uploads/avatars/s.jpg';
      row['user_id'] = '66666666-6666-4666-8666-666666666666';

      final r = Review.fromJson(row);
      expect(r.userName, 'Сергей');
      expect(r.userAvatar, '/uploads/avatars/s.jpg');
      expect(r.userId, '66666666-6666-4666-8666-666666666666');
    });

    test('ни автора, ни имени — «Аноним» и пустой идентификатор', () {
      var row = without(reviewRow(), 'author');
      row = without(row, 'user_id');

      final r = Review.fromJson(row);
      expect(r.userName, 'Аноним');
      expect(r.userId, '');
    });
  });

  group('Текст отзыва', () {
    test('бэкенд шлёт content', () {
      expect(Review.fromJson(reviewRow(content: 'Вкусно')).text, 'Вкусно');
    });

    test('устаревшее имя text тоже читается', () {
      final row = without(reviewRow(), 'content');
      row['text'] = 'Старый формат';
      expect(Review.fromJson(row).text, 'Старый формат');
    });

    test('отзыв без текста — это оценка без слов, а не пустая строка', () {
      final row = without(reviewRow(content: null), 'content');
      expect(Review.fromJson(row).text, isNull);
    });
  });

  group('Ответ партнёра', () {
    test('ответ и его дата разбираются вместе', () {
      final r = Review.fromJson(reviewRow(partnerResponse: 'Спасибо!'));
      expect(r.partnerResponse, 'Спасибо!');
      expect(r.partnerResponseAt, DateTime.utc(2026, 6, 11, 9));
      expect(r.partnerResponderId,
          '55555555-5555-4555-8555-555555555555');
    });

    test('без ответа партнёра поля пусты, а не подставлены', () {
      final r = Review.fromJson(reviewRow());
      expect(r.partnerResponse, isNull);
      expect(r.partnerResponseAt, isNull);
    });
  });

  group('Конверт списка отзывов', () {
    test('reviews и pagination достаются из вложенного data', () {
      final p = PaginatedReviews.fromJson(reviewsEnvelope());

      expect(p.data, hasLength(1));
      expect(p.data.single.userName, 'Ирина');
      expect(p.meta.total, 24);
      expect(p.meta.page, 1);
      expect(p.meta.perPage, 25,
          reason: 'размер страницы в снимке НЕ равен умолчанию модели (10) — '
              'иначе тест не отличит разбор от подстановки');
      expect(p.meta.totalPages, 3);
    });

    test('ключ pages читается — именно его шлёт бэкенд отзывов', () {
      // В поиске тот же смысл назван `totalPages`, здесь — `pages`. Модель
      // обязана понимать имя своего эндпоинта, а не соседнего.
      final env = reviewsEnvelope(pages: 7);
      final p = PaginatedReviews.fromJson(env);
      expect(p.meta.totalPages, 7);
    });

    test('переименование reviews даёт пустой список — это МОЛЧАЛИВЫЙ отказ',
        () {
      // Тест закрепляет цену: если ключ уедет, экран покажет «отзывов пока
      // нет» у заведения с двумя десятками отзывов, и никто не пожалуется,
      // потому что жаловаться не на что — экран выглядит исправным.
      // Утверждение здесь — не одобрение поведения, а его фиксация: пока
      // модель молчит, разрыв обязан быть виден хотя бы в наборе.
      final broken = <String, dynamic>{
        'success': true,
        'data': <String, dynamic>{
          'items': [reviewRow()],
          'pagination': {'page': 1, 'limit': 10, 'total': 24, 'pages': 3},
        },
      };

      final p = PaginatedReviews.fromJson(broken);
      expect(p.data, isEmpty);
      expect(p.meta.total, 24,
          reason: 'счётчик говорит 24, список пуст — противоречие, которое '
              'на экране не показывается ничем');
    });

    test('без блока pagination счётчики нулевые, а не выдуманные', () {
      final env = <String, dynamic>{
        'data': <String, dynamic>{'reviews': [reviewRow()]},
      };
      final p = PaginatedReviews.fromJson(env);

      expect(p.data, hasLength(1));
      expect(p.meta.total, 0);
      expect(p.meta.totalPages, 0);
    });

    test('средняя оценка и число отзывов из блока pagination', () {
      final env = reviewsEnvelope();
      (env['data'] as Map<String, dynamic>)['pagination']['average_rating'] =
          4.25;
      (env['data'] as Map<String, dynamic>)['pagination']['review_count'] = 24;

      final p = PaginatedReviews.fromJson(env);
      expect(p.meta.averageRating, 4.25);
      expect(p.meta.reviewCount, 24);
    });
  });

  group('Отзывы пользователя в профиле', () {
    Map<String, dynamic> userReviewRow() => <String, dynamic>{
          'id': '77777777-7777-4777-8777-777777777777',
          'establishment_id': '11111111-1111-4111-8111-111111111111',
          'establishment': <String, dynamic>{
            'id': '11111111-1111-4111-8111-111111111111',
            'name': 'Васильки',
            'city': 'Минск',
            'category': 'Ресторан',
          },
          'rating': 4,
          'content': 'Хорошо',
          'created_at': '2026-06-10T18:30:00.000Z',
        };

    test('название заведения берётся из вложенного объекта', () {
      final r = UserReview.fromJson(userReviewRow());
      expect(r.establishmentName, 'Васильки');
      expect(r.establishmentType, 'Ресторан');
      expect(r.rating, 4);
    });

    test('плоское establishment_name тоже читается', () {
      final row = without(userReviewRow(), 'establishment');
      row['establishment_name'] = 'Лидо';
      expect(UserReview.fromJson(row).establishmentName, 'Лидо');
    });

    test('подстановка «Заведение» только когда имени нет ни в одной форме',
        () {
      var row = without(userReviewRow(), 'establishment');
      row = without(row, 'establishment_name');
      expect(UserReview.fromJson(row).establishmentName, 'Заведение');
    });

    test('конверт списка отзывов пользователя разбирается', () {
      final env = <String, dynamic>{
        'success': true,
        'data': <String, dynamic>{
          'reviews': [userReviewRow()],
          'pagination': {'total': 3, 'page': 1, 'pages': 1},
        },
      };

      final r = UserReviewsResponse.fromJson(env);
      expect(r.reviews, hasLength(1));
      expect(r.total, 3);
      expect(r.page, 1);
      expect(r.totalPages, 1);
    });

    test('без pagination общее число берётся из длины списка', () {
      final env = <String, dynamic>{
        'data': <String, dynamic>{
          'reviews': [userReviewRow(), userReviewRow()],
        },
      };
      expect(UserReviewsResponse.fromJson(env).total, 2);
    });
  });
}
