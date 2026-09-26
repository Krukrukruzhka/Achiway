import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, MouseEvent } from 'react';

type Page = 'home' | 'profile' | 'habits' | 'my-habits' | 'history' | 'login' | 'register';

type UserProfile = {
  id: string;
  login: string;
  name: string | null;
  age: number | null;
  gender: 'female' | 'male' | 'other' | null;
};

type Habit = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
};

type TargetPeriod = 'day' | 'week' | 'month';

type UserHabit = {
  id: string;
  user_id: string;
  habit_id: string;
  category: string | null;
  target_value: string;
  target_unit: string;
  target_period: TargetPeriod;
  created_at: string;
  archived_at: string | null;
};

const periodLabels: Record<TargetPeriod, string> = {
  day: 'Каждый день',
  week: 'Каждую неделю',
  month: 'Каждый месяц',
};

const pagePaths: Record<Page, string> = {
  home: '/',
  profile: '/profile',
  habits: '/habits',
  'my-habits': '/my-habits',
  history: '/history',
  login: '/login',
  register: '/register',
};

const apiOrigin = window.location.port === '5173'
  ? `${window.location.protocol}//${window.location.hostname}:8000`
  : window.location.origin;

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(new URL(path, apiOrigin), {
    ...options,
    credentials: 'include',
    headers: options?.body
      ? { 'Content-Type': 'application/json', ...options.headers }
      : options?.headers,
  });

  if (!response.ok) {
    let message = 'Не удалось выполнить запрос';
    try {
      const payload = await response.json() as { detail?: string };
      if (typeof payload.detail === 'string') {
        message = payload.detail;
      }
    } catch {
      // The status code still gives the caller enough information to handle the error.
    }
    throw new ApiError(response.status, message);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

function getErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.message === 'Invalid login or password') return 'Неверный логин или пароль.';
    if (error.message === 'Login already exists') return 'Этот логин уже занят.';
    if (error.message === 'Authentication required') return 'Сессия завершена. Войдите снова.';
    if (error.message === 'Habit name already exists') return 'Такая привычка уже есть в каталоге.';
    if (error.message === 'User already has this active habit') {
      return 'Эта привычка уже добавлена. Обновите страницу, чтобы настроить её.';
    }
    if (error.message === 'Active user habit not found') {
      return 'Привычка уже изменена или архивирована. Обновите страницу.';
    }
    if (error.message === 'Habit instance not found') return 'Экземпляр привычки не найден. Обновите страницу.';
    if (error.message === 'Database unavailable') return 'Сервис временно недоступен. Попробуйте ещё раз.';
    if (error.status === 422) return 'Проверьте заполненные поля и допустимые значения.';
    if (error.message === 'Too many login attempts. Try again later') {
      return 'Слишком много неудачных попыток. Попробуйте войти через 15 минут.';
    }
    return error.message;
  }
  return 'Сервис временно недоступен. Попробуйте ещё раз.';
}

function formatHabitCount(count: number) {
  const lastTwoDigits = count % 100;
  const lastDigit = count % 10;
  let word = 'привычек';

  if (lastTwoDigits < 11 || lastTwoDigits > 14) {
    if (lastDigit === 1) word = 'привычка';
    else if (lastDigit >= 2 && lastDigit <= 4) word = 'привычки';
  }
  return `${count} ${word} в каталоге`;
}

function getPage(pathname: string): Page {
  const entry = Object.entries(pagePaths).find(([, path]) => path === pathname);
  return entry ? entry[0] as Page : 'home';
}

function getRequestedHabitId() {
  return window.location.pathname === pagePaths['my-habits']
    ? new URLSearchParams(window.location.search).get('habit') : null;
}

const categoryIconPaths: Record<string, string> = {
  'спорт': 'M6 8H3v8h3m12-8h3v8h-3M6 6h3v12H6zM15 6h3v12h-3zM9 12h6',
  'здоровье': 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
  'самообразование': 'M12 5v16M12 5C9 3 6 3 3 4v15c3-1 6-1 9 2 3-3 6-3 9-2V4c-3-1-6-1-9 1Z',
  'работа': 'M8 7V4h8v3M3 7h18v13H3zM3 12c6 3 12 3 18 0M10 12h4',
  'финансы': 'M20 8V4H4v16h16v-4M4 8h18v8h-7V8M18 12h1',
  'досуг': 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z',
  'питание': 'M7 3v7m-3-7v5a3 3 0 0 0 6 0V3M7 11v10M20 3c-4 0-5 5-5 9h5M20 3v18',
  'сон': 'M20 15a9 9 0 0 1-11-11 9 9 0 1 0 11 11Z',
};

function HabitIcon({ category }: { category: string | null }) {
  const normalized = category?.trim().toLocaleLowerCase('ru') ?? '';
  const key = normalized === 'обучение' || normalized === 'саморазвитие'
    ? 'самообразование' : normalized;
  const path = Object.hasOwn(categoryIconPaths, key) ? categoryIconPaths[key] : undefined;

  return (
    <span className={`habit-icon${path ? '' : ' habit-icon-empty'}`} aria-hidden="true">
      {path && <svg viewBox="0 0 24 24" focusable="false"><path d={path} /></svg>}
    </span>
  );
}

function UserIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m20.7 19.3-4.2-4.2a7.5 7.5 0 1 0-1.4 1.4l4.2 4.2a1 1 0 0 0 1.4-1.4ZM5 10.5a5.5 5.5 0 1 1 11 0 5.5 5.5 0 0 1-11 0Z" />
    </svg>
  );
}

function Header({ currentPage, user, onNavigate, onLogout }: {
  currentPage: Page;
  user: UserProfile;
  onNavigate: (page: Page) => void;
  onLogout: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMenuOpen(false);
  }, [currentPage]);

  useEffect(() => {
    if (!menuOpen) return;

    const closeOutside = (event: Event) => {
      if (event.target instanceof Node && !accountRef.current?.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        avatarRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('focusin', closeOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [menuOpen]);

  const handleNavigation = (event: MouseEvent<HTMLAnchorElement>, page: Page) => {
    event.preventDefault();
    setMenuOpen(false);
    onNavigate(page);
  };

  return (
    <header className="app-header">
      <a className="brand" href={pagePaths.home}
        onClick={(event) => handleNavigation(event, 'home')} aria-label="Achiway — главная">
        <span className="brand-mark" aria-hidden="true">A</span>
        <span>Achiway</span>
      </a>

      <nav className="main-nav" aria-label="Основная навигация">
        <a href={pagePaths.home} className={currentPage === 'home' ? 'active' : ''}
          aria-current={currentPage === 'home' ? 'page' : undefined}
          onClick={(event) => handleNavigation(event, 'home')}>Главная</a>
        <a href={pagePaths['my-habits']} className={currentPage === 'my-habits' ? 'active' : ''}
          aria-current={currentPage === 'my-habits' ? 'page' : undefined}
          onClick={(event) => handleNavigation(event, 'my-habits')}>Мои привычки</a>
        <a href={pagePaths.habits} className={currentPage === 'habits' ? 'active' : ''}
          aria-current={currentPage === 'habits' ? 'page' : undefined}
          onClick={(event) => handleNavigation(event, 'habits')}>Каталог</a>
      </nav>

      <div className="account-menu" ref={accountRef}>
        <button className={`avatar-button ${currentPage === 'profile' || currentPage === 'history' || menuOpen ? 'active' : ''}`}
          ref={avatarRef} type="button" onClick={() => setMenuOpen((open) => !open)}
          aria-label="Меню пользователя" aria-expanded={menuOpen} aria-controls="account-navigation">
          <UserIcon />
        </button>
        {menuOpen && <nav id="account-navigation" className="account-dropdown" aria-label="Меню пользователя">
          <div className="account-identity">
            <strong>{user.name || 'Пользователь'}</strong>
            <span>@{user.login}</span>
          </div>
          <a href={pagePaths.profile} onClick={(event) => handleNavigation(event, 'profile')}
            aria-current={currentPage === 'profile' ? 'page' : undefined}>Профиль</a>
          <a href={pagePaths.history} onClick={(event) => handleNavigation(event, 'history')}
            aria-current={currentPage === 'history' ? 'page' : undefined}>История</a>
          <button type="button" onClick={() => { setMenuOpen(false); onLogout(); }}>Выйти</button>
        </nav>}
      </div>
    </header>
  );
}

function AuthPage({ mode, onAuthenticated, onNavigate }: {
  mode: 'login' | 'register';
  onAuthenticated: (user: UserProfile) => void;
  onNavigate: (page: Page) => void;
}) {
  const [login, setLogin] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const isRegistration = mode === 'register';

  useEffect(() => {
    setError('');
    setPassword('');
  }, [mode]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      const payload = isRegistration
        ? { login, password, name: name.trim() || null }
        : { login, password };
      const authenticatedUser = await apiRequest<UserProfile>(
        isRegistration ? '/auth/register' : '/auth/login',
        { method: 'POST', body: JSON.stringify(payload) },
      );
      onAuthenticated(authenticatedUser);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-intro">
        <div className="brand auth-brand">
          <span className="brand-mark" aria-hidden="true">A</span>
          <span>Achiway</span>
        </div>
        <p className="eyebrow">Личный прогресс</p>
        <h1>{isRegistration ? 'Начните свой путь' : 'Рады видеть вас снова'}</h1>
        <p>Создавайте полезные привычки, отмечайте результаты и наблюдайте, как небольшие действия складываются в большие изменения.</p>
      </section>

      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-switch" aria-label="Выбор действия">
          <button className={!isRegistration ? 'active' : ''} type="button"
            onClick={() => onNavigate('login')}>Вход</button>
          <button className={isRegistration ? 'active' : ''} type="button"
            onClick={() => onNavigate('register')}>Регистрация</button>
        </div>

        <div className="auth-card-heading">
          <h2 id="auth-title">{isRegistration ? 'Создать аккаунт' : 'Войти в аккаунт'}</h2>
          <p>{isRegistration
            ? 'Придумайте уникальный логин и надёжный пароль.'
            : 'Используйте логин и пароль, указанные при регистрации.'}</p>
        </div>

        <form onSubmit={handleSubmit}>
          {isRegistration && (
            <label className="field">
              <span>Имя <small>необязательно</small></span>
              <input autoComplete="name" value={name} maxLength={100}
                placeholder="Как к вам обращаться"
                onChange={(event) => setName(event.target.value)} />
            </label>
          )}

          <label className="field">
            <span>Логин</span>
            <input required autoComplete="username" value={login} maxLength={64}
              pattern="[A-Za-z0-9][A-Za-z0-9_.-]*" placeholder="Например, ivan_petrov"
              onChange={(event) => setLogin(event.target.value)} />
          </label>

          <label className="field">
            <span>Пароль</span>
            <input required type="password"
              autoComplete={isRegistration ? 'new-password' : 'current-password'}
              value={password} minLength={isRegistration ? 12 : 1} maxLength={128}
              placeholder={isRegistration ? 'Не менее 12 символов' : 'Ваш пароль'}
              onChange={(event) => setPassword(event.target.value)} />
          </label>

          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button auth-submit" type="submit" disabled={pending}>
            {pending ? 'Подождите…' : isRegistration ? 'Создать аккаунт' : 'Войти'}
          </button>
        </form>
      </section>
    </main>
  );
}

function ProfilePage({ user, onUpdated }: {
  user: UserProfile;
  onUpdated: (user: UserProfile) => void;
}) {
  const [name, setName] = useState(user.name ?? '');
  const [age, setAge] = useState(user.age?.toString() ?? '');
  const [gender, setGender] = useState<UserProfile['gender']>(user.gender);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setSaved(false);
    setError('');
    try {
      const updated = await apiRequest<UserProfile>('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim() || null,
          age: age === '' ? null : Number(age),
          gender,
        }),
      });
      onUpdated(updated);
      setSaved(true);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="page-shell profile-page">
      <section className="page-heading">
        <p className="eyebrow">Личный кабинет</p>
        <h1>Мой профиль</h1>
        <p>Здесь можно обновить информацию о себе.</p>
      </section>

      <section className="profile-layout">
        <aside className="profile-summary" aria-label="Краткая информация о профиле">
          <div className="profile-avatar"><UserIcon /></div>
          <div><strong>{name.trim() || 'Пользователь'}</strong><span>@{user.login}</span></div>
        </aside>

        <form className="form-card" onSubmit={handleSubmit}>
          <div className="form-card-heading"><div>
            <h2>Личные данные</h2>
            <p>Логин закреплён за профилем и недоступен для редактирования.</p>
          </div></div>

          <label className="field"><span>Логин</span><input value={user.login} disabled /></label>
          <label className="field">
            <span>Имя</span>
            <input value={name} maxLength={100} placeholder="Как к вам обращаться"
              onChange={(event) => { setName(event.target.value); setSaved(false); }} />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Возраст</span>
              <input type="number" value={age} min="0" max="150" placeholder="Не указан"
                onChange={(event) => { setAge(event.target.value); setSaved(false); }} />
            </label>
            <label className="field">
              <span>Пол</span>
              <select value={gender ?? ''} onChange={(event) => {
                setGender(event.target.value === ''
                  ? null : event.target.value as NonNullable<UserProfile['gender']>);
                setSaved(false);
              }}>
                <option value="">Не указан</option>
                <option value="female">Женский</option>
                <option value="male">Мужской</option>
                <option value="other">Другой</option>
              </select>
            </label>
          </div>

          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-actions">
            <button className="primary-button" type="submit" disabled={pending}>
              {pending ? 'Сохраняем…' : 'Сохранить изменения'}
            </button>
            <span className={`save-status ${saved ? 'visible' : ''}`} role="status">Изменения сохранены</span>
          </div>
        </form>
      </section>
    </main>
  );
}

function CatalogHabitDialog({ onCreated, onClose }: {
  onCreated: (habit: Habit) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    dialog?.querySelector<HTMLInputElement>('input')?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    if (!name.trim()) {
      setError('Укажите название привычки.');
      return;
    }
    setPending(true);
    setError('');
    try {
      const created = await apiRequest<Habit>('/habits', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), category: category.trim() || null }),
      });
      onCreated(created);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setPending(false);
    }
  };

  return (
    <dialog ref={dialogRef} className="habit-dialog"
      aria-labelledby="create-habit-title" aria-describedby="create-habit-description"
      onCancel={(event) => { event.preventDefault(); if (!pending) onClose(); }}
      onClick={(event) => {
        if (pending || event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right
          || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}>
      <form onSubmit={handleSubmit} autoComplete="off" aria-busy={pending}>
        <div className="dialog-heading">
          <h2 id="create-habit-title">Новая привычка</h2>
          <button className="dialog-close" type="button" aria-label="Закрыть окно"
            disabled={pending} onClick={onClose}><span aria-hidden="true">×</span></button>
        </div>
        <p id="create-habit-description">Добавьте привычку в общий каталог.</p>
        <fieldset disabled={pending}>
          <label className="field" htmlFor="new-habit"><span>Название</span>
            <input id="new-habit" autoFocus required value={name} maxLength={100}
              placeholder="Например, чтение" onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="field"><span>Категория</span>
            <input value={category} maxLength={64} placeholder="Без категории"
              onChange={(event) => setCategory(event.target.value)} />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-actions">
            <button className="primary-button" type="submit">
              {pending ? 'Сохраняем…' : 'Добавить в каталог'}
            </button>
            <button className="logout-button" type="button" onClick={onClose}>Отмена</button>
          </div>
        </fieldset>
      </form>
    </dialog>
  );
}

function UserHabitForm({ habit, template, onSaved, onCancel, onPendingChange }: {
  habit: Habit;
  template?: UserHabit;
  onSaved: (template: UserHabit) => void;
  onCancel: () => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const categoryRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState((template ? template.category : habit.category) ?? '');
  const [targetValue, setTargetValue] = useState(template ? String(Number(template.target_value)) : '');
  const [targetUnit, setTargetUnit] = useState(template?.target_unit ?? '');
  const [targetPeriod, setTargetPeriod] = useState<TargetPeriod>(template?.target_period ?? 'day');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    categoryRef.current?.focus({ preventScroll: true });
    document.querySelector(`[data-habit-id="${CSS.escape(habit.id)}"]`)?.scrollIntoView({ block: 'nearest' });
    return () => {
      document.querySelector<HTMLButtonElement>(
        `[data-habit-id="${CSS.escape(habit.id)}"] .template-action`,
      )?.focus({ preventScroll: true });
    };
  }, [habit.id, template?.id]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const numericTarget = Number(targetValue);
    if (!Number.isInteger(numericTarget) || numericTarget < 1 || numericTarget > 999999999) {
      setError('Укажите целую цель от 1 до 999999999.');
      return;
    }
    if (!targetUnit.trim()) {
      setError('Укажите единицу измерения.');
      return;
    }
    setPending(true);
    onPendingChange?.(true);
    setError('');
    try {
      const saved = await apiRequest<UserHabit>(
        template ? `/users/me/habits/${template.id}` : '/users/me/habits',
        {
          method: template ? 'PATCH' : 'POST',
          body: JSON.stringify({
            ...(!template && { habit_id: habit.id }),
            category: category.trim() || null,
            target_value: targetValue,
            target_unit: targetUnit.trim(),
            target_period: targetPeriod,
          }),
        },
      );
      onSaved(saved);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setPending(false);
      onPendingChange?.(false);
    }
  };

  return (
    <form className="form-card template-editor" onSubmit={handleSubmit} autoComplete="off"
      aria-labelledby="template-editor-title" aria-busy={pending}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !pending) {
          event.preventDefault();
          onCancel();
        }
      }}>
      <div className="form-card-heading">
        <h2 id="template-editor-title">{template ? 'Настройки шаблона' : `Добавить привычку: ${habit.name}`}</h2>
        <p>{template ? 'Новые настройки применятся со следующего периода. Текущий результат и история сохранятся.'
          : 'Задайте свою категорию и цель на выбранный период.'}</p>
      </div>
      <fieldset disabled={pending}>
        <div className="field-row">
          <label className="field"><span>Моя категория</span>
            <input ref={categoryRef} autoFocus value={category} maxLength={64} placeholder="Без категории"
              onChange={(event) => setCategory(event.target.value)} />
          </label>
          <label className="field"><span>Период</span>
            <select value={targetPeriod}
              onChange={(event) => setTargetPeriod(event.target.value as TargetPeriod)}>
              {Object.entries(periodLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="field-row">
          <label className="field"><span>Цель</span>
            <input type="number" inputMode="numeric" required min="1" max="999999999" step="1"
              value={targetValue} placeholder="Например, 30"
              onChange={(event) => setTargetValue(event.target.value)} />
          </label>
          <label className="field"><span>Единица измерения</span>
            <input required value={targetUnit} maxLength={32} placeholder="Например, минут"
              onChange={(event) => setTargetUnit(event.target.value)} />
          </label>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button className="primary-button" type="submit">
            {pending ? 'Сохраняем…' : template ? 'Сохранить' : 'Сохранить привычку'}
          </button>
          <button className="logout-button" type="button" onClick={onCancel}>Отмена</button>
        </div>
      </fieldset>
    </form>
  );
}

function HabitsPage({ page, requestedHabitId, onNavigate, onEditClosed }: {
  page: 'habits' | 'my-habits';
  requestedHabitId: string | null;
  onNavigate: (page: Page, habitId?: string) => void;
  onEditClosed: () => void;
}) {
  const isCatalog = page === 'habits';
  const [habits, setHabits] = useState<Habit[]>([]);
  const [templates, setTemplates] = useState<UserHabit[]>([]);
  const [editing, setEditing] = useState<{ habit: Habit; template?: UserHabit } | null>(null);
  const [editingPending, setEditingPending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [saved, setSaved] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  useEffect(() => {
    let active = true;
    setLoadError('');
    Promise.all([apiRequest<Habit[]>('/habits'), apiRequest<UserHabit[]>('/users/me/habits')])
      .then(([items, userTemplates]) => {
        if (active) {
          setHabits(items);
          setTemplates(userTemplates);
          setLoaded(true);
        }
      })
      .catch((requestError: unknown) => { if (active) setLoadError(getErrorMessage(requestError)); });
    return () => { active = false; };
  }, [reload]);

  useEffect(() => {
    if (isCatalog) return;
    if (!requestedHabitId) {
      setEditing(null);
      return;
    }
    if (!loaded) return;
    const habit = habits.find((item) => item.id === requestedHabitId);
    const template = templates.find((item) => item.habit_id === requestedHabitId);
    setSaved(false);
    setEditing(habit ? { habit, template } : null);
  }, [isCatalog, requestedHabitId, loaded, habits, templates]);

  const missingRequestedHabit = !isCatalog && loaded && requestedHabitId
    && !habits.some((item) => item.id === requestedHabitId);
  const addingHabit = editing && !editing.template ? editing.habit : null;

  const handleTemplateSaved = (template: UserHabit) => {
    setTemplates((current) => current.some((item) => item.habit_id === template.habit_id)
      ? current.map((item) => item.habit_id === template.habit_id ? template : item)
      : [template, ...current]);
    setEditing(null);
    setCreateOpen(false);
    setSaved(true);
    if (!isCatalog) onEditClosed();
  };

  const closeEditor = () => {
    setEditing(null);
    if (!isCatalog) onEditClosed();
  };

  const filteredHabits = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('ru');
    if (!normalizedQuery) return habits;
    return habits.filter((habit) => (
      habit.name.toLocaleLowerCase('ru').includes(normalizedQuery)
      || (habit.category ?? '').toLocaleLowerCase('ru').includes(normalizedQuery)
    ));
  }, [habits, query]);

  const suggestions = query.trim() ? filteredHabits.slice(0, 4) : [];

  const handleCreated = (habit: Habit) => {
    setHabits((current) => [habit, ...current]);
    setQuery('');
    setCreateOpen(false);
    setSaved(true);
  };

  return (
    <main className="page-shell habits-page">
      <section className="page-heading">
        <div><h1>{isCatalog ? 'Каталог привычек' : 'Мои привычки'}</h1>
          <p>{isCatalog ? 'Выбирайте привычки и настраивайте свои цели.' : 'Ваши категории, периоды и цели.'}</p></div>
      </section>

      {isCatalog && createOpen && <CatalogHabitDialog
        onCreated={handleCreated}
        onClose={() => setCreateOpen(false)} />}

      {loadError && <div className="form-error" role="alert">
        <p>{loadError}</p>
        <button className="logout-button" type="button" onClick={() => setReload((value) => value + 1)}>
          Повторить загрузку
        </button>
      </div>}
      {!loaded && !loadError && <p role="status">Загружаем привычки…</p>}
      {missingRequestedHabit && <p className="form-error" role="alert">
        Привычка не найдена. Возможно, она была удалена из каталога.
      </p>}
      {saved && <p className="save-status visible" role="status">Привычка сохранена</p>}

      {!isCatalog && loaded && <section aria-labelledby="my-habits-title">
        <div className="catalog-heading my-habits-heading">
          <div><h2 id="my-habits-title">Выбранные привычки</h2></div>
        </div>
        <div className="user-habit-list">
          {addingHabit && <article className="user-habit-card expanded" data-habit-id={addingHabit.id}>
            <div className="habit-item user-habit-summary">
              <HabitIcon category={addingHabit.category} />
              <div><h3>{addingHabit.name}</h3>
                <p>{addingHabit.category ?? 'Без категории'}</p>
                <p className="template-target">Задайте цель, чтобы сохранить привычку.</p>
              </div>
              <button className="logout-button template-action" type="button" disabled={editingPending}
                aria-expanded="true" aria-controls={`habit-settings-${addingHabit.id}`}
                aria-label={`Отменить добавление: ${addingHabit.name}`} onClick={closeEditor}>
                Отмена
              </button>
            </div>
            <div id={`habit-settings-${addingHabit.id}`} className="user-habit-settings">
              <UserHabitForm key={addingHabit.id} habit={addingHabit}
                onSaved={handleTemplateSaved} onCancel={closeEditor} onPendingChange={setEditingPending} />
            </div>
          </article>}
          {templates.length > 0 ? templates.map((template) => {
            const habit = habits.find((item) => item.id === template.habit_id);
            const isExpanded = editing?.template?.id === template.id;
            const settingsId = `habit-settings-${template.habit_id}`;
            return (
              <article className={`user-habit-card${isExpanded ? ' expanded' : ''}`}
                key={template.habit_id} data-habit-id={template.habit_id}>
                <div className="habit-item user-habit-summary">
                  <HabitIcon category={template.category} />
                  <div><h3>{habit?.name ?? 'Привычка'}</h3>
                    <p>{template.category ?? 'Без категории'}</p>
                    <p className="template-target">{Number(template.target_value).toLocaleString('ru-RU', {
                      maximumFractionDigits: 3,
                    })} {template.target_unit} · {periodLabels[template.target_period]}</p>
                  </div>
                  <button className="logout-button template-action" type="button" disabled={!habit || editingPending}
                    aria-expanded={isExpanded} aria-controls={settingsId}
                    aria-label={`${isExpanded ? 'Свернуть настройки' : 'Настроить шаблон'}: ${habit?.name ?? 'Привычка'}`}
                    onClick={() => {
                      if (isExpanded) closeEditor();
                      else if (habit) onNavigate('my-habits', habit.id);
                    }}>
                    {isExpanded ? 'Свернуть' : 'Настроить шаблон'}
                  </button>
                </div>
                {isExpanded && habit && <div id={settingsId} className="user-habit-settings">
                  <UserHabitForm key={template.id} habit={habit} template={template}
                    onSaved={handleTemplateSaved} onCancel={closeEditor} onPendingChange={setEditingPending} />
                </div>}
              </article>
            );
          }) : !addingHabit && <div className="empty-state"><h3>Пока нет привычек</h3>
            <p>Выберите привычку из каталога и задайте свою цель.</p>
            <button className="logout-button" type="button" onClick={() => onNavigate('habits')}>
              Открыть каталог
            </button></div>}
        </div>
      </section>}

      {isCatalog && <section className="catalog-card" aria-labelledby="catalog-title">
        <div className="catalog-heading">
          <div><h2 id="catalog-title">Все привычки</h2><p>{formatHabitCount(habits.length)}</p></div>
          <div className="catalog-tools">
            <div className="search-wrap">
              <SearchIcon />
              <label className="visually-hidden" htmlFor="habit-search">Поиск привычек</label>
              <input id="habit-search" type="search" autoComplete="off" value={query}
                placeholder="Найти привычку" onFocus={() => setSearchFocused(true)}
                onBlur={() => window.setTimeout(() => setSearchFocused(false), 120)}
                onChange={(event) => setQuery(event.target.value)} />
              {searchFocused && query.trim() && (
                <div className="suggestions" role="listbox" aria-label="Подсказки поиска">
                  {suggestions.length > 0 ? suggestions.map((habit) => (
                    <button key={habit.id} type="button" role="option" aria-selected="false"
                      onClick={() => { setQuery(habit.name); setSearchFocused(false); }}>
                      <SearchIcon /><span>{habit.name}</span>
                      <small>{habit.category ?? 'без категории'}</small>
                    </button>
                  )) : <p>Совпадений не найдено</p>}
                </div>
              )}
            </div>
            <button className="catalog-add" type="button"
              disabled={!loaded} aria-label="Добавить привычку в каталог"
              title="Добавить привычку в каталог" aria-haspopup="dialog"
              onClick={() => { setSearchFocused(false); setCreateOpen(true); }}>
              <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
        </div>

        <div className="habit-list" aria-live="polite">
          {filteredHabits.length > 0 ? filteredHabits.map((habit) => {
            const hasTemplate = templates.some((item) => item.habit_id === habit.id);
            return (
              <article className="habit-item" key={habit.id}>
                <HabitIcon category={habit.category} />
                <div><h3>{habit.name}</h3><p>{habit.category ?? 'без категории'}</p></div>
                <button className="logout-button template-action" type="button" disabled={!loaded}
                  aria-label={`${hasTemplate ? 'Настроить' : 'Добавить себе'}: ${habit.name}`}
                  onClick={() => onNavigate('my-habits', habit.id)}>
                  {hasTemplate ? 'Настроить' : 'Добавить себе'}
                </button>
              </article>
            );
          }) : loaded ? (
            <div className="empty-state"><span aria-hidden="true">⌕</span>
              <h3>Ничего не найдено</h3><p>Попробуйте изменить запрос или создайте новую привычку.</p></div>
          ) : null}
        </div>
      </section>}
    </main>
  );
}

type HabitInstance = {
  id: string;
  user_habit_id: string;
  habit_name: string;
  category: string | null;
  period_start: string;
  period_end: string;
  target_value: string;
  target_unit: string;
  target_period: TargetPeriod;
  result_value: string;
  status: 'active' | 'done' | 'tried' | 'skipped';
};

type InstancePage = { items: HabitInstance[]; has_more: boolean; server_time: string };

const instanceStatusLabels: Record<HabitInstance['status'], string> = {
  active: 'Активно', done: 'Выполнено', tried: 'Частично', skipped: 'Пропущено',
};
const instanceDateFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow', day: 'numeric', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
});
const formatResult = (value: string) => Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 3 });

function InstanceCard({ instance, expired, onSaved, onExpired }: {
  instance: HabitInstance;
  expired: boolean;
  onSaved: (instance: HabitInstance) => void;
  onExpired: () => void;
}) {
  const [value, setValue] = useState(String(Number(instance.result_value)));
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const saving = useRef(false);

  useEffect(() => {
    if (!dirty) setValue(String(Number(instance.result_value)));
  }, [instance.result_value, dirty]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving.current || expired) return;
    const result = Number(value);
    if (value.trim() === '' || !Number.isFinite(result) || result < 0 || result > 999999999.999
      || Math.abs(result * 1000 - Math.round(result * 1000)) > 0.001) {
      setError('Укажите результат от 0 до 999999999,999, не более трёх знаков после запятой.');
      return;
    }
    saving.current = true;
    setPending(true);
    setError('');
    setSaved(false);
    try {
      const updated = await apiRequest<HabitInstance>(`/users/me/habit-instances/${instance.id}`, {
        method: 'PATCH', body: JSON.stringify({ result_value: value }),
      });
      onSaved(updated);
      setValue(String(Number(updated.result_value)));
      setDirty(false);
      setSaved(true);
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 409) {
        setError('Период завершён. Результат уже находится в истории.');
        onExpired();
      } else setError(getErrorMessage(requestError));
    } finally {
      saving.current = false;
      setPending(false);
    }
  };

  return (
    <article className="user-habit-card instance-card">
      <div className="instance-heading">
        <HabitIcon category={instance.category} />
        <div className="instance-title"><h2>{instance.habit_name}</h2>
          <p>{instance.category ?? 'Без категории'}</p></div>
        <span className={`instance-status instance-status-${instance.status}`}>
          {instanceStatusLabels[instance.status]}
        </span>
      </div>
      <p className="instance-period">
        <time dateTime={instance.period_start}>{instanceDateFormat.format(new Date(instance.period_start))}</time>
        {' — '}
        <time dateTime={instance.period_end}>{instanceDateFormat.format(new Date(instance.period_end))}</time> · МСК
      </p>
      <p className="instance-result"><strong>{formatResult(instance.result_value)}</strong>
        {' / '}{formatResult(instance.target_value)} {instance.target_unit}</p>
      {instance.status === 'active' && <form className="instance-form" autoComplete="off" onSubmit={handleSubmit}>
        <label className="field"><span>Результат за период, {instance.target_unit}</span>
          <input type="number" inputMode="decimal" required min="0" max="999999999.999" step="0.001"
            value={value} disabled={pending || expired}
            onChange={(event) => { setValue(event.target.value); setDirty(true); setSaved(false); }} />
        </label>
        <button className="primary-button" type="submit" disabled={pending || expired}>
          {pending ? 'Сохраняем…' : 'Сохранить результат'}
        </button>
        <p className="instance-hint">{expired ? 'Период завершён. Обновляем экземпляры…'
          : 'Укажите общий результат с начала периода. Статус изменится автоматически в конце периода.'}</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        {saved && <p className="save-status visible" role="status">Результат сохранён</p>}
      </form>}
    </article>
  );
}

function InstancesPage({ page, onNavigate }: {
  page: 'home' | 'history';
  onNavigate: (page: Page) => void;
}) {
  const [items, setItems] = useState<HabitInstance[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [reload, setReload] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const [serverOffset, setServerOffset] = useState(0);
  const requestVersion = useRef(0);
  const refreshedBoundary = useRef('');
  const isHistory = page === 'history';

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    const refresh = () => { if (!document.hidden) setReload((value) => value + 1); };
    const refreshTimer = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(refreshTimer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const version = ++requestVersion.current;
    setLoading(true);
    apiRequest<InstancePage>(`/users/me/habit-instances?state=${isHistory ? 'history' : 'active'}&offset=${offset}`, {
      signal: controller.signal,
    }).then((result) => {
      if (version !== requestVersion.current || controller.signal.aborted) return;
      if (offset > 0 && result.items.length === 0) { setOffset(0); return; }
      setItems(result.items);
      setHasMore(result.has_more);
      setServerOffset(Date.parse(result.server_time) - Date.now());
      setLoaded(true);
      setError('');
    }).catch((requestError: unknown) => {
      if (!controller.signal.aborted && version === requestVersion.current) setError(getErrorMessage(requestError));
    }).finally(() => {
      if (!controller.signal.aborted && version === requestVersion.current) setLoading(false);
    });
    return () => controller.abort();
  }, [isHistory, offset, reload]);

  const now = clock + serverOffset;
  const boundary = items.find((item) => item.status === 'active' && Date.parse(item.period_end) <= now)?.period_end;
  useEffect(() => {
    if (boundary && refreshedBoundary.current !== boundary) {
      refreshedBoundary.current = boundary;
      setReload((value) => value + 1);
    }
  }, [boundary]);

  const handleSaved = (updated: HabitInstance) => {
    ++requestVersion.current;
    setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
    setReload((value) => value + 1);
  };

  return (
    <main className="page-shell instances-page">
      <section className="page-heading"><h1>{isHistory ? 'История' : 'Текущие привычки'}</h1>
        <p>{isHistory ? 'Результаты завершённых периодов.'
          : 'Отмечайте результат — каждая привычка идёт в своём ритме.'} Время указано по Москве.</p>
      </section>
      {error && <div className="form-error" role="alert"><p>{error}</p>
        <button className="logout-button" type="button" disabled={loading}
          onClick={() => setReload((value) => value + 1)}>Повторить загрузку</button></div>}
      {!loaded && !error && <p role="status">Загружаем привычки…</p>}
      {loaded && <div className="instance-list">
        {items.map((instance) => <InstanceCard key={instance.id} instance={instance}
          expired={Date.parse(instance.period_end) <= now}
          onSaved={handleSaved} onExpired={() => setReload((value) => value + 1)} />)}
        {items.length === 0 && <div className="empty-state">
          <h3>{isHistory ? 'История пока пуста' : 'Пока нет активных привычек'}</h3>
          <p>{isHistory ? 'Здесь появятся результаты после завершения первого периода.'
            : 'Добавьте привычку и задайте цель — первый период начнётся сразу.'}</p>
          {!isHistory && <button className="logout-button" type="button"
            onClick={() => onNavigate('habits')}>Открыть каталог</button>}
        </div>}
      </div>}
      {(offset > 0 || hasMore) && <nav className="instance-pagination" aria-label="Страницы привычек">
        <button className="logout-button" type="button" disabled={offset === 0 || loading}
          onClick={() => { setLoaded(false); setItems([]); setOffset((value) => Math.max(0, value - 50)); }}>Назад</button>
        <span>Страница {offset / 50 + 1}</span>
        <button className="logout-button" type="button" disabled={!hasMore || loading}
          onClick={() => { setLoaded(false); setItems([]); setOffset((value) => value + 50); }}>Далее</button>
      </nav>}
    </main>
  );
}

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>(() => getPage(window.location.pathname));
  const [requestedHabitId, setRequestedHabitId] = useState<string | null>(getRequestedHabitId);
  const [user, setUser] = useState<UserProfile | null | undefined>(undefined);

  useEffect(() => {
    apiRequest<UserProfile>('/auth/me')
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPage(getPage(window.location.pathname));
      setRequestedHabitId(getRequestedHabitId());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = (page: Page, habitId?: string) => {
    const pageChanged = window.location.pathname !== pagePaths[page];
    const requestedId = page === 'my-habits' ? habitId ?? null : null;
    const path = pagePaths[page] + (requestedId ? `?${new URLSearchParams({ habit: requestedId })}` : '');
    if (window.location.pathname + window.location.search !== path) window.history.pushState({}, '', path);
    setCurrentPage(page);
    setRequestedHabitId(requestedId);
    if (pageChanged) window.scrollTo({ top: 0 });
  };

  const clearHabitSelection = () => {
    if (window.location.pathname !== pagePaths['my-habits'] || getRequestedHabitId() !== requestedHabitId) return;
    window.history.replaceState({}, '', pagePaths['my-habits']);
    setRequestedHabitId(null);
  };

  const handleAuthenticated = (authenticatedUser: UserProfile) => {
    setUser(authenticatedUser);
    navigate('home');
  };

  const handleLogout = async () => {
    try {
      await apiRequest<void>('/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      navigate('login');
    }
  };

  if (user === undefined) {
    return <main className="loading-page" aria-label="Загрузка"><span className="brand-mark">A</span></main>;
  }

  if (user === null) {
    return <AuthPage mode={currentPage === 'register' ? 'register' : 'login'}
      onAuthenticated={handleAuthenticated} onNavigate={navigate} />;
  }

  const authenticatedPage = currentPage === 'login' || currentPage === 'register'
    ? 'home' : currentPage;

  return (
    <div className="app">
      <Header currentPage={authenticatedPage} user={user}
        onNavigate={navigate} onLogout={handleLogout} />
      {authenticatedPage === 'profile' && <ProfilePage user={user} onUpdated={setUser} />}
      {(authenticatedPage === 'habits' || authenticatedPage === 'my-habits') && (
        <HabitsPage key={authenticatedPage} page={authenticatedPage} requestedHabitId={requestedHabitId}
          onNavigate={navigate} onEditClosed={clearHabitSelection} />
      )}
      {(authenticatedPage === 'home' || authenticatedPage === 'history') && (
        <InstancesPage key={authenticatedPage} page={authenticatedPage} onNavigate={navigate} />
      )}
    </div>
  );
}
