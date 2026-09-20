import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, MouseEvent } from 'react';

type Page = 'home' | 'profile' | 'habits' | 'login' | 'register';

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
      return 'У вас уже есть шаблон этой привычки. Обновите страницу, чтобы изменить его.';
    }
    if (error.message === 'Active user habit not found') {
      return 'Шаблон уже изменён или архивирован. Обновите страницу.';
    }
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
  const handleNavigation = (event: MouseEvent<HTMLAnchorElement>, page: Page) => {
    event.preventDefault();
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
        <a href={pagePaths.habits} className={currentPage === 'habits' ? 'active' : ''}
          aria-current={currentPage === 'habits' ? 'page' : undefined}
          onClick={(event) => handleNavigation(event, 'habits')}>Привычки</a>
      </nav>

      <div className="account-actions">
        <span className="account-login">@{user.login}</span>
        <button className="logout-button" type="button" onClick={onLogout}>Выйти</button>
        <a className={`avatar-link ${currentPage === 'profile' ? 'active' : ''}`}
          href={pagePaths.profile} onClick={(event) => handleNavigation(event, 'profile')}
          aria-label="Открыть профиль"
          aria-current={currentPage === 'profile' ? 'page' : undefined}>
          <UserIcon />
        </a>
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

function HomePage({ user, onNavigate }: { user: UserProfile; onNavigate: (page: Page) => void }) {
  return (
    <main className="page-shell welcome-page">
      <section className="welcome-card">
        <p className="eyebrow">Добро пожаловать</p>
        <h1>{user.name ? `${user.name}, продолжим?` : 'Продолжим путь?'}</h1>
        <p>Выберите привычку, которую хотите развивать, и сделайте следующий небольшой шаг.</p>
        <button className="primary-button" type="button" onClick={() => onNavigate('habits')}>
          Открыть привычки
        </button>
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

function UserHabitForm({ habit, template, onSaved, onCancel }: {
  habit: Habit;
  template?: UserHabit;
  onSaved: (template: UserHabit) => void;
  onCancel: () => void;
}) {
  const [category, setCategory] = useState((template ? template.category : habit.category) ?? '');
  const [targetValue, setTargetValue] = useState(template?.target_value ?? '');
  const [targetUnit, setTargetUnit] = useState(template?.target_unit ?? '');
  const [targetPeriod, setTargetPeriod] = useState<TargetPeriod>(template?.target_period ?? 'day');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    if (!targetUnit.trim()) {
      setError('Укажите единицу измерения.');
      return;
    }
    setPending(true);
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
    }
  };

  return (
    <form className="form-card template-editor" onSubmit={handleSubmit}
      aria-labelledby="template-editor-title">
      <div className="form-card-heading">
        <h2 id="template-editor-title">{template ? 'Настроить шаблон' : 'Новый шаблон'}: {habit.name}</h2>
        <p>Задайте свою категорию и цель на выбранный период.</p>
        {template && <p>При изменении цели история предыдущих результатов сохранится.</p>}
      </div>
      <fieldset disabled={pending}>
        <div className="field-row">
          <label className="field"><span>Моя категория</span>
            <input autoFocus value={category} maxLength={64} placeholder="Без категории"
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
            <input type="number" required min="0.001" max="999999999.999" step="0.001"
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
            {pending ? 'Сохраняем…' : 'Сохранить шаблон'}
          </button>
          <button className="logout-button" type="button" onClick={onCancel}>Отмена</button>
        </div>
      </fieldset>
    </form>
  );
}

function HabitsPage() {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [templates, setTemplates] = useState<UserHabit[]>([]);
  const [editing, setEditing] = useState<{ habit: Habit; template?: UserHabit } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [saved, setSaved] = useState(false);
  const [newHabit, setNewHabit] = useState('');
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

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

  const openEditor = (habit: Habit, template?: UserHabit) => {
    setSaved(false);
    setEditing({ habit, template });
  };

  const handleTemplateSaved = (template: UserHabit) => {
    setTemplates((current) => [template, ...current.filter((item) => item.habit_id !== template.habit_id)]);
    setEditing(null);
    setSaved(true);
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

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || !loaded || editing !== null) return;
    const name = newHabit.trim();
    if (!name) return;
    setPending(true);
    setError('');
    try {
      const created = await apiRequest<Habit>('/habits', {
        method: 'POST', body: JSON.stringify({ name }),
      });
      setHabits((current) => [created, ...current]);
      setNewHabit('');
      openEditor(created);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="page-shell habits-page">
      <section className="page-heading habits-heading">
        <div><p className="eyebrow">Каталог</p><h1>Привычки</h1>
          <p>Выбирайте привычки и настраивайте свои цели.</p></div>

        <form className="create-habit" onSubmit={handleCreate}>
          <label htmlFor="new-habit">Новая привычка</label>
          <div className="create-habit-row">
            <input id="new-habit" value={newHabit} maxLength={100}
              placeholder="Например, чтение"
              onChange={(event) => setNewHabit(event.target.value)} />
            <button className="primary-button icon-button" type="submit" disabled={pending || !loaded || editing !== null}
              aria-label="Создать привычку">
              <span aria-hidden="true">+</span><span className="button-label">Добавить</span>
            </button>
          </div>
          {error && <p className="form-error compact-error" role="alert">{error}</p>}
        </form>
      </section>

      {loadError && <div className="form-error" role="alert">
        <p>{loadError}</p>
        <button className="logout-button" type="button" onClick={() => setReload((value) => value + 1)}>
          Повторить загрузку
        </button>
      </div>}
      {!loaded && !loadError && <p role="status">Загружаем привычки и шаблоны…</p>}
      {saved && <p className="save-status visible" role="status">Шаблон сохранён</p>}
      {editing && <UserHabitForm key={editing.template?.id ?? editing.habit.id}
        habit={editing.habit} template={editing.template}
        onSaved={handleTemplateSaved} onCancel={() => setEditing(null)} />}

      {loaded && <section className="catalog-card my-templates" aria-labelledby="my-templates-title">
        <div className="catalog-heading">
          <div><h2 id="my-templates-title">Мои шаблоны</h2><p>Ваши категории, периоды и цели</p></div>
        </div>
        <div className="habit-list">
          {templates.length > 0 ? templates.map((template) => {
            const habit = habits.find((item) => item.id === template.habit_id);
            return (
              <article className="habit-item" key={template.id}>
                <span className="habit-check" aria-hidden="true">✓</span>
                <div><h3>{habit?.name ?? 'Привычка'}</h3>
                  <p>{template.category ?? 'Без категории'}</p>
                  <p className="template-target">{Number(template.target_value).toLocaleString('ru-RU', {
                    maximumFractionDigits: 3,
                  })} {template.target_unit} · {periodLabels[template.target_period]}</p>
                </div>
                <button className="logout-button template-action" type="button" disabled={!habit || pending || editing !== null}
                  aria-label={`Настроить шаблон: ${habit?.name ?? 'Привычка'}`}
                  onClick={() => { if (habit) openEditor(habit, template); }}>Настроить</button>
              </article>
            );
          }) : <div className="empty-state"><h3>Пока нет шаблонов</h3>
            <p>Выберите привычку из каталога и задайте свою цель.</p></div>}
        </div>
      </section>}

      <section className="catalog-card" aria-labelledby="catalog-title">
        <div className="catalog-heading">
          <div><h2 id="catalog-title">Все привычки</h2><p>{formatHabitCount(habits.length)}</p></div>
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
        </div>

        <div className="habit-list" aria-live="polite">
          {filteredHabits.length > 0 ? filteredHabits.map((habit) => (
            <article className="habit-item" key={habit.id}>
              <span className="habit-check" aria-hidden="true">✓</span>
              <div><h3>{habit.name}</h3><p>{habit.category ?? 'без категории'}</p></div>
              <button className="logout-button template-action" type="button" disabled={!loaded || pending || editing !== null}
                aria-label={`Настроить: ${habit.name}`}
                onClick={() => openEditor(habit, templates.find((item) => item.habit_id === habit.id))}>
                {templates.some((item) => item.habit_id === habit.id) ? 'Настроить' : 'Добавить себе'}
              </button>
            </article>
          )) : loaded ? (
            <div className="empty-state"><span aria-hidden="true">⌕</span>
              <h3>Ничего не найдено</h3><p>Попробуйте изменить запрос или создайте новую привычку.</p></div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>(() => getPage(window.location.pathname));
  const [user, setUser] = useState<UserProfile | null | undefined>(undefined);

  useEffect(() => {
    apiRequest<UserProfile>('/auth/me')
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    const handlePopState = () => setCurrentPage(getPage(window.location.pathname));
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = (page: Page) => {
    const path = pagePaths[page];
    if (window.location.pathname !== path) window.history.pushState({}, '', path);
    setCurrentPage(page);
    window.scrollTo({ top: 0 });
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
      {authenticatedPage === 'habits' && <HabitsPage />}
      {authenticatedPage === 'home' && <HomePage user={user} onNavigate={navigate} />}
    </div>
  );
}
