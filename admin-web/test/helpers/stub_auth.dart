import 'package:restaurant_guide_admin_web/models/user.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/services/auth_service.dart';

/// Сеть в стендах не нужна: `AuthProvider` дёргает сервис в конструкторе.
class NoopAuthService implements AuthService {
  @override
  Future<bool> isAuthenticated() async => false;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// Вошедший задаётся стендом напрямую — авторизацию проходить незачем.
///
/// Экраны читают роль через `canModerate`, а тот считается от геттера
/// [currentUser], который здесь и подменён.
class StubAuthProvider extends AuthProvider {
  @override
  final User? currentUser;

  StubAuthProvider(this.currentUser) : super(authService: NoopAuthService());

  StubAuthProvider.admin()
      : this(const User(
          id: 'admin-1',
          email: 'admin@nirivio.by',
          name: 'Сергей Админов',
          role: 'admin',
        ));

  StubAuthProvider.viewer()
      : this(const User(
          id: 'viewer-1',
          email: 'viewer@nirivio.by',
          name: 'Ольга Наблюдателева',
          role: 'viewer',
        ));
}
