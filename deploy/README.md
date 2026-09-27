# Ручной деплой Achiway

Целевой сервер: Ubuntu 24.04, `ssh me`, публичный IP `37.230.168.87`.
Docker и Compose на сервере уже установлены. Ручные сборки и проверки образов
выполняются **на сервере**, в отдельном временном Compose-проекте, а не локально.
Команды серверной подготовки ниже тоже выполняются **на сервере**.

Это инструкция первоначальной настройки. Наличие файлов в репозитории не означает,
что сервер уже подготовлен или сертификат выпущен. Другие приложения и их контейнеры
не останавливать. Перед установкой повторно проверить порты `80`, `443`, `18080`.

## 1. Опубликовать первые образы

После отправки файлов в `main` открыть GitHub → Actions → Deploy → Run workflow.
Выбрать `main`, оставить `deploy_to_server` выключенным. Workflow повторяет CI,
собирает `linux/amd64`, проверяет контейнеры на одноразовой БД и публикует образы.
Никаких SSH-секретов для этого запуска не нужно.

После успешного запуска открыть Packages профиля Krukrukruzhka. Для обоих пакетов
`achiway-backend` и `achiway-frontend` выбрать Package settings → Change visibility
→ Public. Новые пакеты GHCR первоначально приватные даже при публичном репозитории.
Сервер скачивает эти два публичных образа без токена GitHub.

В Summary запуска сохраняются digest обоих образов. На сервер передаются только
digest, поэтому изменение тега не подменяет выбранную версию.

## 2. Подготовить сервер административным доступом

Передать проверенный каталог `deploy/` на сервер из локального корня проекта:

```sh
scp -r deploy me:achiway-deploy-setup
ssh me
cd ~/achiway-deploy-setup
sudo ss -ltnp
```

Далее команды выполняются в этом каталоге на сервере. При занятом `80`, `443`
или `18080` сначала выяснить владельца порта; не останавливать чужой сервис.

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

## 3. Настроить nginx и HTTPS по IP

```sh
sudo apt-get update
sudo apt-get install -y nginx
sudo install -d -m 755 /var/lib/achiway-acme
sudo install -m 644 host-nginx-http.conf /etc/nginx/sites-available/achiway
sudo ln -s /etc/nginx/sites-available/achiway /etc/nginx/sites-enabled/achiway
sudo nginx -t
sudo systemctl reload nginx
sudo snap install --classic certbot
sudo /snap/bin/certbot --version
```

Для сертификата IP с webroot требуется Certbot 5.4 или новее. Проверить внешнюю
доступность HTTP: `http://37.230.168.87/` должен отвечать 503 с текстом подготовки.
Если соединение не устанавливается, проверить правила сети у провайдера для TCP
80/443. Не менять правила, обслуживающие другие приложения.

```sh
sudo /snap/bin/certbot certonly --webroot --webroot-path /var/lib/achiway-acme \
  --preferred-profile shortlived --ip-address 37.230.168.87 --cert-name 37.230.168.87 \
  --deploy-hook '/usr/sbin/nginx -t && /usr/bin/systemctl reload nginx'
sudo install -m 644 host-nginx.conf /etc/nginx/sites-available/achiway
sudo nginx -t
sudo systemctl reload nginx
sudo install -m 644 achiway-cert-renew.service achiway-cert-renew.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now achiway-cert-renew.timer
sudo /snap/bin/certbot renew --cert-name 37.230.168.87 --dry-run --run-deploy-hooks
```

При первом выпуске Certbot запросит контактный email и согласие с условиями.
Сертификат короткоживущий: продление проверяется каждые шесть часов, успешное
обновление вызывает проверку и reload nginx. Журнал: `journalctl -u achiway-cert-renew.service`.

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
| Variable | `DEPLOY_PORT` | `22` |
| Secret | `DEPLOY_SSH_KEY` | Содержимое локального `~/.ssh/achiway_github` |
| Secret | `DEPLOY_KNOWN_HOSTS` | Проверенная строка `37.230.168.87 ssh-ed25519 ...` из ключа сервера |

Закрытый ключ не отправлять в чат и не добавлять в репозиторий. Секреты и variables
можно добавить через `gh secret set --env production` и `gh variable set --env production`.

Actions → Deploy → Run workflow → `main` → включить `deploy_to_server`.
Workflow повторно проверит исходный код и контейнеры, опубликует образы и передаст
их digest серверу. Обновления идут последовательно; на сервере дополнительно
удерживается блокировка. Временная БД проверок никогда не является production-БД.

Порядок выкладки: скачать образы → проверить БД → включить 503 → остановить
приложение → сохранить и проверить архив БД → выполнить миграции → запустить
контейнеры → проверить готовность → снять 503. После этого GitHub проверяет HTTPS.
Первый запуск создаёт пустую БД в отдельном томе `achiway_postgres_data`.

## Ошибка выкладки и восстановление

- До остановки приложения ошибка загрузки образов не прерывает его работу.
- При ошибке без изменения схемы сценарий возвращает предыдущие образы, если
  предыдущий успешный релиз существует. Workflow всё равно завершается ошибкой.
- После ошибки миграции, смены схемы или неудачного отката остаётся 503.
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

Изменения Compose, nginx и привилегированного сценария устанавливает администратор
после проверки, отдельно от обновления образов через GitHub.
