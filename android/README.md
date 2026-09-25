# Para для Google Play (Android)

Приложение — обёртка TWA: внутри открывается сайт `para.skycoax.uz` в полноэкранном
Chrome, без адресной строки. Правки сайта попадают в приложение сами, пересобирать
и заново публиковать для этого не нужно. Пересборка нужна, только если меняются
иконка, название, цвета или версия.

Проект создан Bubblewrap из манифеста сайта. Настройки — `twa-manifest.json`.

## Что нужно на компьютере

| Что | Где сейчас лежит |
|---|---|
| JDK 17 (Bubblewrap и Gradle работают именно с ним) | `D:\android-tools\jdk-17.0.20.1+1` |
| Android SDK | `C:\Users\user\AppData\Local\Android\Sdk` |
| Bubblewrap CLI | ставился глобально: `npm i -g @bubblewrap/cli` |

Сборка идёт через Gradle напрямую — так надёжнее: Bubblewrap ждёт SDK в своём
формате и на обычный SDK от Android Studio ругается.

## Шаг 1. Ключ подписи (делается один раз)

Ключ подписывает все будущие версии. **Потеряешь ключ — приложение нельзя будет
обновить**, придётся публиковать новое с нуля. Храни файл и пароль в надёжном месте,
например в менеджере паролей, и сделай копию не на этом компьютере.

Пароль придумываешь сам и вводишь сам — я его не вижу и не храню.

```bash
"D:\android-tools\jdk-17.0.20.1+1\bin\keytool.exe" -genkeypair -v \
  -keystore D:\android-tools\para-upload.keystore \
  -alias para -keyalg RSA -keysize 2048 -validity 10000
```

Спросит пароль (дважды) и данные владельца — можно заполнить как угодно,
на пользователей это не влияет.

Дальше создай файл `android/keystore.properties`:

```properties
storeFile=D:/android-tools/para-upload.keystore
storePassword=ТВОЙ_ПАРОЛЬ
keyAlias=para
keyPassword=ТВОЙ_ПАРОЛЬ
```

Этот файл никуда не выкладывается и нужен только для сборки на этом компьютере.

## Шаг 2. Собрать подписанный пакет

```bash
cd android
JAVA_HOME="D:/android-tools/jdk-17.0.20.1+1" \
ANDROID_HOME="C:/Users/user/AppData/Local/Android/Sdk" \
./gradlew bundleRelease
```

Готовый файл: `android/app/build/outputs/bundle/release/app-release.aab` — его
и загружают в Play Console. Для проверки на своём телефоне удобнее APK:
`./gradlew assembleRelease` → `android/app/build/outputs/apk/release/app-release.apk`.

## Шаг 3. Связать сайт и приложение (assetlinks)

Без этого приложение откроется с адресной строкой Chrome сверху.

1. Отпечаток ключа:
   ```bash
   "D:\android-tools\jdk-17.0.20.1+1\bin\keytool.exe" -list -v \
     -keystore D:\android-tools\para-upload.keystore -alias para | findstr SHA256
   ```
2. После первой загрузки в Play Console: **Тестирование и выпуск → Настройка →
   Целостность приложения → Подписание приложений** — там свой SHA-256 ключа Google.
   Нужны **оба** отпечатка: Google подписывает то, что скачивают пользователи,
   а локальные сборки подписаны твоим ключом.
3. Оба вписать в `server/hub/assetlinks.json` (см. образец ниже) и выложить сайт:
   `DEPLOY_HOST=skycoax-vps bash deploy/deploy.sh`. Проверка:
   `curl https://para.skycoax.uz/.well-known/assetlinks.json`.

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "uz.skycoax.para",
    "sha256_cert_fingerprints": ["ОТПЕЧАТОК_ТВОЕГО_КЛЮЧА", "ОТПЕЧАТОК_КЛЮЧА_GOOGLE"]
  }
}]
```

## Новая версия приложения

1. В `twa-manifest.json` поднять `appVersionCode` (целое число, строго больше
   предыдущего) и `appVersion`.
2. Те же числа — в `android/app/build.gradle` (`versionCode`, `versionName`).
3. Собрать заново (шаг 2) и загрузить новый `.aab`.

Иконку и цвета приложение берёт из `server/hub` при пересборке проекта
(`bubblewrap update`), а не из сайта на лету.
