# Ручной деплой Achiway

Целевой сервер: Ubuntu 24.04, `ssh me`, публичный IP `37.230.168.87`.
Docker и Compose на сервере уже установлены. Ручные сборки и проверки образов
выполняются **на сервере**, в отдельном временном Compose-проекте, а не локально.
Команды серверной подготовки ниже тоже выполняются **на сервере**.

Это инструкция первоначальной настройки. Наличие файлов в репозитории не означает,
что сервер уже подготовлен. Другие приложения и их контейнеры
не останавливать. Перед установкой повторно проверить порт `8020`.

## 1. Опубликовать первые образы

После отправки файлов в `main` открыть GitHub → Actions → Deploy → Run workflow.
Выбрать `main`, оставить `deploy_to_server` выключенным. Workflow повторяет CI,
собирает `linux/amd64`, проверяет контейнеры на одноразовой БД и публикует образы.
Никаких SSH-секретов для этого запуска не нужно.

Пакеты `achiway-backend` и `achiway-frontend` уже публичные: анонимный доступ
проверен с сервера. Повторно менять видимость не нужно. Сервер скачивает эти
образы без токена GitHub.

В Summary запуска сохраняются digest обоих образов. На сервер передаются только
digest, поэтому изменение тега не подменяет выбранную версию.

## 2. Подготовить сервер административным доступом

Передать проверенный каталог `deploy/` на сервер из локального корня проекта:

```sh
ssh me 'mkdir -p ~/achiway-deploy-setup'
scp deploy/* me:achiway-deploy-setup/
ssh me
cd ~/achiway-deploy-setup
sudo ss -ltnp
```

Далее команды выполняются в этом каталоге на сервере. При занятом `8020` сначала
выяснить владельца порта; не останавливать чужой сервис. Порт 80 для Achiway
не используется, работающий на нём nginx не мешает запуску.

```sh
sudo install -d -o root -g root -m 755 /opt/achiway
sudo install -d -o root -g root -m 700 /opt/achiway/backups
sudo install -o root -g root -m 600 compose.yaml /opt/achiway/compose.yaml
sudo install -o root -g root -m 755 achiway-deploy.py /usr/local/sbin/achiway-deploy
sudo install -o root -g root -m 755 achiway-ssh /usr/local/bin/achiway-ssh
sudo python3 - <<'PY'
import os
from pathlib import Path
import secrets
os.umask(0o077)
path = Path('/opt/achiway/secrets.env')
if path.exists():
    print('Existing secrets.env preserved')
else:
    with path.open('x') as output:
        output.write('POSTGRES_PASSWORD=' + secrets.token_hex(32) + '\n')
    print('Created secrets.env without printing its contents')
PY
```

Пароль используется в URL подключения, поэтому генерация использует hex-символы.
Не заменять пароль в существующем томе через редактирование этого файла:
переменная `POSTGRES_PASSWORD` инициализирует только новую базу.

## 3. Проверить порт 8020 для контейнера

По выбору пользователя приложение доступно по `http://37.230.168.87:8020` без HTTPS.
Docker публикует `0.0.0.0:8020` сервера на порт `8080` контейнера frontend. Nginx
работает только в этом контейнере: отдаёт React и передаёт `/api/` в backend.
Отдельный nginx на сервере, Certbot, сертификат и порт 443 не нужны.

Пароли и cookie сессии передаются без шифрования и могут быть перехвачены.
В Compose задано `SESSION_COOKIE_SECURE=false`, чтобы вход работал по HTTP;
`HttpOnly` и `SameSite=Lax` сохраняются, но не шифруют трафик. При переходе на HTTPS
нужно вернуть `SESSION_COOKIE_SECURE=true`.

Проверить, что порт 8020 свободен:

```sh
sudo ss -ltnp '( sport = :8020 )'
```

Список слушающих процессов должен быть пустым. Если порт занят, сначала разобраться
с его владельцем; чужие сервисы не останавливать. Серверный nginx на порту 80 для
этого развёртывания менять или останавливать не нужно.

До первого деплоя и во время остановки контейнеров сайт будет недоступен; отдельной
страницы 503 нет. После успешного деплоя проверить `http://37.230.168.87:8020/` и
`http://37.230.168.87:8020/api/health/ready`. Если соединение не устанавливается,
проверить публикацию порта Docker и правила входящего TCP 8020 у провайдера сервера.
Не менять правила других приложений.

Для проверок контейнеров использовать отдельный Compose-проект и явно задавать
`HTTP_BIND_HOST=127.0.0.1` и свободный `HTTP_PORT` (например, `18082`), чтобы не
публиковать проверочное приложение в интернете. GitHub Actions задаёт loopback и
порт `18080`. Production-сценарий фиксирует `HTTP_BIND_HOST=0.0.0.0` и `HTTP_PORT=8020`.

## 4. Дать GitHub ограниченный доступ

Создать **на своём компьютере** отдельный ключ, не используя личный ключ `ssh me`:

```sh
ssh-keygen -t ed25519 -f ~/.ssh/achiway_github -C achiway-github-actions -N ''
scp ~/.ssh/achiway_github.pub me:achiway-deploy-setup/deploy-key.pub
```

На сервере, в `~/achiway-deploy-setup`:

```sh
sudo useradd --system --create-home --home-dir /var/lib/achiway-deploy --shell /bin/sh achiway-deploy
sudo chown root:root /var/lib/achiway-deploy
sudo chmod 755 /var/lib/achiway-deploy
sudo install -d -o root -g root -m 755 /var/lib/achiway-deploy/.ssh
sudo python3 - <<'PY'
from pathlib import Path
public_key = Path('deploy-key.pub').read_text().strip()
if not public_key.startswith('ssh-ed25519 ') or '\n' in public_key:
    raise SystemExit('Expected one Ed25519 public key')
path = Path('/var/lib/achiway-deploy/.ssh/authorized_keys')
with path.open('x') as output:
    output.write('restrict,command="/usr/local/bin/achiway-ssh" ' + public_key + '\n')
path.chmod(0o644)
PY
sudo visudo -cf achiway.sudoers
sudo install -o root -g root -m 440 achiway.sudoers /etc/sudoers.d/achiway
sudo visudo -c
```

Этот пользователь не входит в группу `docker`. Его домашний каталог, ключи,
Compose, сценарий обновления и sudoers доступны для записи только root.
Сценарий принимает исключительно `deploy sha256:<64 hex> sha256:<64 hex>` и
скачивает образы из двух фиксированных репозиториев GHCR. Нет произвольного shell,
SFTP, туннелей, доступа к Docker socket или возможности заменить серверный Compose.
Новый код приложения всё равно считается доверенным: он получает доступ к данным Achiway.

Проверить с локального компьютера: запрос `ssh -i ~/.ssh/achiway_github
-o IdentitiesOnly=yes achiway-deploy@37.230.168.87 id` должен быть отклонён сценарием.
Ключ сервера нужно сверить через уже доверенное подключение `ssh me` с
`sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`, а не принимать новый ключ
вслепую через `ssh-keyscan`.

## 5. Настроить GitHub и выполнить деплой

В Settings → Environments создать `production` и разрешить deployment branch
только `main` (Selected branches and tags → branch `main`). Добавить:

| Тип | Имя | Значение |
| --- | --- | --- |
| Variable | `DEPLOY_HOST` | `37.230.168.87` |
| Variable | `DEPLOY_PORT` | `22` (порт SSH, не HTTP) |
| Secret | `DEPLOY_SSH_KEY` | Содержимое локального `~/.ssh/achiway_github` |
| Secret | `DEPLOY_KNOWN_HOSTS` | Проверенная строка `37.230.168.87 ssh-ed25519 ...` из ключа сервера |

Закрытый ключ не отправлять в чат и не добавлять в репозиторий. Секреты и variables
можно добавить через `gh secret set --env production` и `gh variable set --env production`.

Actions → Deploy → Run workflow → `main` → включить `deploy_to_server`.
Workflow повторно проверит исходный код и контейнеры, опубликует образы и передаст
их digest серверу. Обновления идут последовательно; на сервере дополнительно
удерживается блокировка. Временная БД проверок никогда не является production-БД.

Порядок выкладки: скачать образы → проверить БД → установить маркер обновления →
остановить приложение → сохранить и проверить архив БД → выполнить миграции →
запустить контейнеры → проверить готовность → удалить маркер обновления. После этого GitHub проверяет
HTTP-адрес `/api/health/ready`.
Первый запуск создаёт пустую БД в отдельном томе `achiway_postgres_data`.

## Ошибка выкладки и восстановление

- До остановки приложения ошибка загрузки образов не прерывает его работу.
- При ошибке без изменения схемы сценарий возвращает предыдущие образы, если
  предыдущий успешный релиз существует. Workflow всё равно завершается ошибкой.
- При ошибке сценарий останавливает frontend и backend перед попыткой отката.
  После ошибки миграции или смены схемы они остаются остановленными; при ошибке
  самой остановки или отката нужно вручную проверить состояние контейнеров.
  Повторный деплой блокируется файлом `/opt/achiway/maintenance`, пока администратор
  не выяснит состояние БД и возможных оставшихся контейнеров миграции.
- Текущие digest находятся в `/opt/achiway/current.json`, предыдущие — в
  `previous.json`; архивы БД и сведения о схеме — в `/opt/achiway/backups/`.
  Хранятся последние семь проверенных архивов; это локальные копии, не защита
  от потери всего сервера.
- Для диагностики использовать административный `ssh me`, журналы workflow и
  контейнеров проекта `achiway`. Не выводить `secrets.env` и полный Docker inspect.
- Автоматического downgrade или восстановления архива нет. Если миграция уже
  изменила схему, сначала выбрать исправление вперёд либо отдельно согласовать
  восстановление из копии. Удалять maintenance-файл можно только после проверки
  согласованности схемы и выбранных образов.
- Не выполнять `docker compose down --volumes` для production и не очищать
  глобальный Docker cache: на сервере есть другие приложения.

Изменения Compose и привилегированного сценария устанавливает администратор
после проверки, отдельно от обновления образов через GitHub. Конфигурация nginx
входит в образ frontend и обновляется вместе с ним.
