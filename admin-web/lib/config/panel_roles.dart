/// Роли панели — зеркало `backend/src/config/panelRoles.js`.
///
/// `admin` действует, `viewer` только читает. Решение Координатора
/// 2026-09-08 (SDL CAT-C-2.11): панель переезжает с машины оператора на
/// хостинг Railway, и свой человек может показать её третьей стороне.
/// Полные права для этого выдать нельзя — каждая кнопка панели бьёт по
/// живым партнёрам, — поэтому у панели появилась роль, которая видит всё и
/// не меняет ничего.
///
/// Клиент прячет кнопки по [canModerateRole], но охрана — на сервере:
/// каждый маршрут действия отвечает просмотрщику 403 независимо от того,
/// что нарисовано на экране.
library;

const String kAdminRole = 'admin';
const String kViewerRole = 'viewer';

/// Роли, которым сервер открывает вход в панель.
const Set<String> kPanelRoles = <String>{kAdminRole, kViewerRole};

bool isPanelRole(String? role) => role != null && kPanelRoles.contains(role);

/// Может ли роль действовать: одобрять, приостанавливать, скрывать.
bool canModerateRole(String? role) => role == kAdminRole;

bool isViewerRole(String? role) => role == kViewerRole;

/// Подпись роли в подвале рейла — про одного человека, в единственном числе.
/// Множественное число для долей аналитики живёт в `kUserRoles`.
const Map<String, String> kPanelRoleLabels = <String, String>{
  kAdminRole: 'Администратор',
  kViewerRole: 'Только просмотр',
};

String panelRoleLabel(String role) => kPanelRoleLabels[role] ?? role;

/// Подпись вместо контактов партнёра для роли «только просмотр».
///
/// Сервер отдал `null` не потому, что данных нет, а потому, что вошедший их
/// видеть не должен (`partner_data_redacted`). Пустая ячейка утверждала бы
/// первое, и просмотрщик решил бы, что партнёр не заполнил контакты.
const String kRedactedForViewerLabel = 'Скрыто в режиме просмотра';
