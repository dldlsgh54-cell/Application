# 배포 / 설치 방법

보안 때문에 APK 파일을 외부로 빼기 어렵다면, APK를 전달하지 말고 보안 PC에서 휴대폰으로 바로 설치하는 방식을 권장합니다.

## 0. 휴대폰 연결도 안 되는 보안 PC인 경우

보안 PC에 휴대폰 USB 연결도 불가능하고, APK/소스 반출도 불가능하면 그 PC에서 만든 앱을 실제 휴대폰에 설치하는 방법은 없습니다.

Android 앱은 설치를 위해 결국 APK/AAB 파일이 아래 중 하나의 경로로 휴대폰에 도착해야 합니다.

- USB/ADB 직접 설치
- APK 파일 직접 전달
- Google Play, 사내 앱스토어, MDM, EMM 같은 배포 시스템
- 외부 개발 PC에서 같은 앱을 다시 빌드

따라서 현재 조건에서 가능한 선택지는 다음 3가지입니다.

1. 보안 승인 반출
   - 보안 담당자 승인 절차로 `shorts-auto-release.apk`, 릴리스 APK, 또는 AAB를 반출합니다.
   - 반출 후 휴대폰에서 직접 설치하거나 배포 시스템에 올립니다.
2. 사내 배포 시스템 사용
   - 보안망 내부에 MDM, 사내 앱스토어, Knox Manage, EMM 같은 경로가 있으면 거기에 APK/AAB를 등록합니다.
   - 휴대폰은 해당 시스템을 통해 앱을 설치합니다.
3. 외부 개발 PC에서 동일 앱 재생성
   - 보안 PC의 파일을 빼지 못하면, 외부 PC에서 같은 프로젝트를 새로 만들어 빌드해야 합니다.
   - 이 경우 소스 파일을 외부 PC에 다시 작성해야 합니다.

휴대폰 연결도 막혀 있고, 사내 배포 시스템도 없고, 파일 반출도 안 되면 배포는 불가능합니다. 이건 코드 문제가 아니라 설치 파일이 휴대폰으로 이동할 경로가 없는 상태입니다.

## 1. 가장 쉬운 방법: Android Studio Run

1. Android Studio에서 프로젝트 폴더를 엽니다.
2. 휴대폰을 USB로 연결합니다.
3. 휴대폰에서 개발자 옵션을 켭니다.
4. `USB 디버깅`을 켭니다.
5. Android Studio 상단 기기 목록에서 휴대폰을 선택합니다.
6. `Run` 버튼을 누릅니다.

이 방식은 APK 파일을 따로 꺼내지 않고 연결된 폰에 바로 설치합니다.

보안 PC에서 휴대폰 연결이 막혀 있으면 이 방법은 사용할 수 없습니다.

## 2. 스크립트로 USB 바로 설치

PowerShell에서 프로젝트 루트 기준으로 실행합니다.

```powershell
.\scripts\install-debug-usb.ps1
```

동작:

1. `:app:assembleDebug`로 APK 빌드
2. 연결된 Android 기기 확인
3. `adb install -r`로 바로 설치
4. 앱 실행

APK 경로는 내부적으로 아래에 생기지만, 밖으로 옮길 필요가 없습니다.

```text
shorts-auto-release.apk
```

보안 PC에서 휴대폰 연결이 막혀 있으면 이 방법은 사용할 수 없습니다.

## 3. APK만 내부 생성

보안 PC 안에서 APK 파일만 만들려면:

```powershell
.\scripts\build-debug-apk.ps1
```

생성 위치:

```text
app/build/outputs/apk/release/app-release.apk
```

## 4. 여러 대 폰에 설치해야 할 때

보안 정책상 파일 반출이 안 되면 다음 중 하나를 사용합니다.

- 각 폰을 보안 PC에 USB로 연결해서 `install-debug-usb.ps1` 반복 실행
- Android Studio에서 기기만 바꿔가며 `Run`
- 사내 MDM 또는 사내 앱 배포 서버가 있으면 그 안에 APK 업로드
- Google Play Console 내부 테스트는 가능하지만 APK/AAB 업로드가 필요하므로 보안 반출 정책 확인 필요

휴대폰 연결도 막혀 있으면 USB 설치 방식은 제외하고, 보안 승인 반출 또는 사내 배포 시스템만 현실적인 방법입니다.

## 5. GitHub로 배포할 수 있나?

가능은 하지만, 보안 PC 기준에서는 GitHub 업로드도 외부 반출입니다.

즉 아래 파일 중 하나라도 GitHub에 올리면 보안 자료가 외부로 나가는 것입니다.

- 프로젝트 소스 코드
- `shorts-auto-release.apk`
- 릴리스 APK
- AAB
- Gradle 설정 파일

따라서 보안 정책상 반출이 금지되어 있으면 GitHub로 보내는 것도 하면 안 됩니다.

승인을 받은 경우에는 두 가지 방식이 있습니다.

### 방식 A: APK를 GitHub Release에 업로드

1. 보안 승인 후 APK를 반출합니다.
2. GitHub private repository를 만듭니다.
3. `Releases`에 APK를 업로드합니다.
4. 폰에서 GitHub Release 페이지를 열어 APK를 다운로드합니다.
5. Android에서 `알 수 없는 앱 설치 허용` 후 설치합니다.

이 방식은 가장 간단하지만 APK 파일을 직접 외부에 올립니다.

### 방식 B: 소스만 올리고 GitHub Actions에서 APK 빌드

1. 보안 승인 후 프로젝트 소스를 GitHub private repository에 올립니다.
2. GitHub Actions가 APK를 빌드합니다.
3. 빌드된 APK artifact 또는 Release APK를 폰에서 받습니다.

이 방식도 소스 코드가 외부로 올라가므로 보안 승인 없이는 사용할 수 없습니다.

이 프로젝트에는 `.github/workflows/android-debug-apk.yml`이 포함되어 있어 GitHub에 push하면 자동으로 APK를 빌드합니다.

폰에서 받는 순서:

1. 폰 브라우저에서 GitHub 저장소를 엽니다.
2. `Releases`를 엽니다.
3. `Latest Debug APK`를 엽니다.
4. `Assets`에서 `shorts-auto-release.apk`를 다운로드합니다.
5. `shorts-auto-release.apk`를 실행합니다.
6. `알 수 없는 앱 설치 허용`을 켠 뒤 설치합니다.

Release가 아직 안 보이면 Actions 빌드가 끝나지 않은 상태입니다. 이때는 아래 순서로 확인합니다.

1. `Actions` 탭으로 이동합니다.
2. 가장 최근 `Build Android Debug APK` 실행 항목을 엽니다.
3. 초록 체크가 뜰 때까지 기다립니다.
4. 다시 `Releases`에서 `Latest Debug APK`를 확인합니다.

GitHub 앱보다 Chrome/삼성 인터넷 같은 브라우저에서 여는 편이 APK 다운로드와 압축 해제가 더 편합니다.

### 폰에서 GitHub 소스만 받는 것은 부족함

폰에서 GitHub 프로젝트 zip을 다운로드해도 앱으로 바로 설치할 수 없습니다. Android 앱은 APK/AAB로 빌드되어야 설치됩니다.

정리하면:

- 보안 승인 있음: GitHub private repo + Release APK 가능
- 보안 승인 없음: GitHub 업로드 불가
- 휴대폰 USB 연결 불가 + 파일 반출 불가 + 사내 배포 없음: 설치 불가

## 6. 폰에서 최초 설정

설치 후 폰에서 한 번만 설정합니다.

1. 앱 실행
2. `접근성 설정` 클릭
3. `쇼츠 이미지 자동생성 접근성 서비스` 활성화
4. ChatGPT 앱에 로그인
5. 앱으로 돌아와 프롬프트 입력 또는 자동 가져오기
6. `시작`

## 7. 빌드가 안 될 때

이 프로젝트는 Java 17이 필요합니다.

Android Studio가 설치되어 있으면 보통 내장 JDK가 자동 설정됩니다. 터미널에서 빌드할 때 `JAVA_HOME` 오류가 나면 Android Studio에서 실행하거나, `JAVA_HOME`을 Android Studio JBR 또는 JDK 17 경로로 설정하세요.

예시:

```powershell
$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"
$env:Path="$env:JAVA_HOME\bin;$env:Path"
.\gradlew.bat :app:assembleDebug
```
