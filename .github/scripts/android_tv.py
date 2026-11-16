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
if "supportsPictureInPicture" not in text:
    anchor = 'android:name=".MainActivity"'
    assert text.count(anchor) == 1
    text = text.replace(anchor, anchor + '\n            android:supportsPictureInPicture="true"', 1)
if "android:banner" not in text:
    text = text.replace("<application", '<application\n        android:banner="@drawable/tv_banner"', 1)
manifest.write_text(text, encoding="utf-8")
drawable = app / "res" / "drawable"
drawable.mkdir(parents=True, exist_ok=True)
shutil.copy("src-tauri/icons/tv_banner.png", drawable / "tv_banner.png")
res = app / "res"
for fg in pathlib.Path("src-tauri/icons/android").glob("mipmap-*/wistv_fg.png"):
    target = res / fg.parent.name
    target.mkdir(parents=True, exist_ok=True)
    shutil.copy(fg, target / "wistv_fg.png")
adaptive = res / "mipmap-anydpi-v26"
adaptive.mkdir(parents=True, exist_ok=True)
layers = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/wistv_icon_bg" />\n    <foreground android:drawable="@mipmap/wistv_fg" />\n</adaptive-icon>\n'
for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
    (adaptive / name).write_text(layers, encoding="utf-8")
values = res / "values"
values.mkdir(parents=True, exist_ok=True)
(values / "wistv_icon.xml").write_text('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="wistv_icon_bg">#111115</color>\n</resources>\n', encoding="utf-8")
print(text)
