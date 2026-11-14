import pathlib
import shutil

app = pathlib.Path("src-tauri/gen/android/app/src/main")
manifest = app / "AndroidManifest.xml"
text = manifest.read_text(encoding="utf-8")
assert text.count("<application") == 1
if "android.hardware.touchscreen" not in text:
    text = text.replace("<application", '<uses-feature android:name="android.hardware.touchscreen" android:required="false" />\n    <application', 1)
if "android.software.leanback" not in text:
    text = text.replace("<application", '<uses-feature android:name="android.software.leanback" android:required="false" />\n    <application', 1)
if "LEANBACK_LAUNCHER" not in text:
    launcher = '<category android:name="android.intent.category.LAUNCHER" />'
    assert text.count(launcher) == 1
    text = text.replace(launcher, launcher + '\n                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />')
if "android:banner" not in text:
    text = text.replace("<application", '<application\n        android:banner="@drawable/tv_banner"', 1)
manifest.write_text(text, encoding="utf-8")
drawable = app / "res" / "drawable"
drawable.mkdir(parents=True, exist_ok=True)
shutil.copy("src-tauri/icons/tv_banner.png", drawable / "tv_banner.png")
print(text)
