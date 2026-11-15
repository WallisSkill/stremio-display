import AVFoundation
import AVKit
import CoreMedia
import CoreVideo
import ObjectiveC
import Tauri
import UIKit
import WebKit

final class VideoLayer: CAMetalLayer {
    override var drawableSize: CGSize {
        get { super.drawableSize }
        set {
            if Int(newValue.width) > 1 && Int(newValue.height) > 1 {
                super.drawableSize = newValue
            }
        }
    }
}

final class VideoView: UIView {
    override class var layerClass: AnyClass { VideoLayer.self }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard let metal = layer as? CAMetalLayer else { return }
        let scale = metal.contentsScale
        let size = CGSize(width: (bounds.width * scale).rounded(), height: (bounds.height * scale).rounded())
        if metal.drawableSize != size {
            metal.drawableSize = size
        }
    }
}

enum Orientation {
    static var mask: UIInterfaceOrientationMask = .portrait
    private static var patched = Set<ObjectIdentifier>()

    static func install(from view: UIView) {
        var controllers: [UIViewController] = []
        var responder: UIResponder? = view
        while let r = responder {
            if let vc = r as? UIViewController {
                controllers.append(vc)
                break
            }
            responder = r.next
        }
        if let root = view.window?.rootViewController {
            controllers.append(root)
        }
        for vc in controllers {
            patch(type(of: vc))
        }
    }

    private static func patch(_ cls: AnyClass) {
        let id = ObjectIdentifier(cls)
        if patched.contains(id) {
            return
        }
        patched.insert(id)
        let orientations: @convention(block) (AnyObject) -> UInt = { _ in Orientation.mask.rawValue }
        replace(cls, #selector(getter: UIViewController.supportedInterfaceOrientations), imp_implementationWithBlock(orientations), "Q@:")
        let hidden: @convention(block) (AnyObject) -> Bool = { _ in Orientation.mask != .portrait }
        replace(cls, #selector(getter: UIViewController.prefersStatusBarHidden), imp_implementationWithBlock(hidden), "B@:")
        replace(cls, #selector(getter: UIViewController.prefersHomeIndicatorAutoHidden), imp_implementationWithBlock(hidden), "B@:")
        let child: @convention(block) (AnyObject) -> AnyObject? = { _ in nil }
        replace(cls, #selector(getter: UIViewController.childForStatusBarHidden), imp_implementationWithBlock(child), "@@:")
    }

    private static func replace(_ cls: AnyClass, _ sel: Selector, _ imp: IMP, _ types: String) {
        if !class_addMethod(cls, sel, imp, types), let method = class_getInstanceMethod(cls, sel) {
            method_setImplementation(method, imp)
        }
    }

    static func apply(_ next: UIInterfaceOrientationMask) {
        mask = next
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        if #available(iOS 16.0, *) {
            for scene in scenes {
                for window in scene.windows {
                    window.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
                }
                scene.requestGeometryUpdate(.iOS(interfaceOrientations: next)) { _ in }
            }
        } else {
            let target: UIInterfaceOrientation = next == .portrait ? .portrait : .landscapeRight
            UIDevice.current.setValue(target.rawValue, forKey: "orientation")
            UIViewController.attemptRotationToDeviceOrientation()
        }
        for scene in scenes {
            for window in scene.windows {
                var vc = window.rootViewController
                while let c = vc {
                    c.setNeedsStatusBarAppearanceUpdate()
                    c.setNeedsUpdateOfHomeIndicatorAutoHidden()
                    vc = c.presentedViewController
                }
            }
        }
    }
}

struct AwakeArgs: Decodable {
    let on: Bool
}

struct LevelArgs: Decodable {
    let level: Double
}

struct OpenArgs: Decodable {
    let url: String
}

@_silgen_name("wistv_audio_interrupted")
func wistvAudioInterrupted()

@_silgen_name("wistv_pip_started")
func wistvPipStarted(_ ok: Bool)

@_silgen_name("wistv_pip_stopped")
func wistvPipStopped(_ restored: Bool)

@_silgen_name("wistv_pip_play")
func wistvPipPlay(_ on: Bool)

@_silgen_name("wistv_pip_skip")
func wistvPipSkip(_ seconds: Double)

@_silgen_name("wistv_pip_auto")
func wistvPipAuto()

final class PipView: UIView {
    override class var layerClass: AnyClass { AVSampleBufferDisplayLayer.self }
}

final class PipFrames {
    static let shared = PipFrames()
    let view = PipView(frame: .zero)
    let display: AVSampleBufferDisplayLayer
    var paused = false
    private var pool: CVPixelBufferPool?
    private var width = 0
    private var height = 0
    private var format: CMVideoFormatDescription?
    private var current: CVPixelBuffer?

    private init() {
        display = view.layer as! AVSampleBufferDisplayLayer
        display.videoGravity = .resizeAspect
        display.backgroundColor = UIColor.black.cgColor
        view.isUserInteractionEnabled = false
        view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    }

    func begin(_ w: Int, _ h: Int, _ stride: UnsafeMutablePointer<Int>) -> UnsafeMutableRawPointer? {
        if pool == nil || width != w || height != h {
            let attrs: [String: Any] = [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                kCVPixelBufferWidthKey as String: w,
                kCVPixelBufferHeightKey as String: h,
                kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any](),
            ]
            var made: CVPixelBufferPool?
            CVPixelBufferPoolCreate(nil, nil, attrs as CFDictionary, &made)
            pool = made
            width = w
            height = h
            format = nil
        }
        guard let pool else { return nil }
        var buffer: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess, let buffer else { return nil }
        CVPixelBufferLockBaseAddress(buffer, [])
        stride.pointee = CVPixelBufferGetBytesPerRow(buffer)
        current = buffer
        return CVPixelBufferGetBaseAddress(buffer)
    }

    func placeholder() {
        let attrs: [String: Any] = [kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any]()]
        var made: CVPixelBuffer?
        guard CVPixelBufferCreate(nil, 16, 9, kCVPixelFormatType_32BGRA, attrs as CFDictionary, &made) == kCVReturnSuccess, let buffer = made else { return }
        CVPixelBufferLockBaseAddress(buffer, [])
        if let base = CVPixelBufferGetBaseAddress(buffer) {
            memset(base, 0, CVPixelBufferGetDataSize(buffer))
        }
        CVPixelBufferUnlockBaseAddress(buffer, [])
        var described: CMVideoFormatDescription?
        CMVideoFormatDescriptionCreateForImageBuffer(allocator: nil, imageBuffer: buffer, formatDescriptionOut: &described)
        guard let described else { return }
        var timing = CMSampleTimingInfo(duration: .invalid, presentationTimeStamp: CMClockGetTime(CMClockGetHostTimeClock()), decodeTimeStamp: .invalid)
        var sample: CMSampleBuffer?
        CMSampleBufferCreateReadyWithImageBuffer(allocator: nil, imageBuffer: buffer, formatDescription: described, sampleTiming: &timing, sampleBufferOut: &sample)
        guard let sample else { return }
        show(sample)
    }

    private func show(_ sample: CMSampleBuffer) {
        if let list = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: true), CFArrayGetCount(list) > 0 {
            let dict = unsafeBitCast(CFArrayGetValueAtIndex(list, 0), to: CFMutableDictionary.self)
            CFDictionarySetValue(dict, Unmanaged.passUnretained(kCMSampleAttachmentKey_DisplayImmediately).toOpaque(), Unmanaged.passUnretained(kCFBooleanTrue).toOpaque())
        }
        if display.status == .failed {
            display.flush()
        }
        display.enqueue(sample)
    }

    func end(_ ok: Bool) {
        guard let buffer = current else { return }
        current = nil
        CVPixelBufferUnlockBaseAddress(buffer, [])
        guard ok else { return }
        if format == nil {
            CMVideoFormatDescriptionCreateForImageBuffer(allocator: nil, imageBuffer: buffer, formatDescriptionOut: &format)
        }
        guard let format else { return }
        var timing = CMSampleTimingInfo(duration: .invalid, presentationTimeStamp: CMClockGetTime(CMClockGetHostTimeClock()), decodeTimeStamp: .invalid)
        var sample: CMSampleBuffer?
        CMSampleBufferCreateReadyWithImageBuffer(allocator: nil, imageBuffer: buffer, formatDescription: format, sampleTiming: &timing, sampleBufferOut: &sample)
        guard let sample else { return }
        show(sample)
    }
}

final class PipControl: NSObject, AVPictureInPictureControllerDelegate, AVPictureInPictureSampleBufferPlaybackDelegate {
    static let shared = PipControl()
    private var controller: AVPictureInPictureController?
    private var restored = false
    private var armed = false

    private func make() {
        guard controller == nil else { return }
        let source = AVPictureInPictureController.ContentSource(sampleBufferDisplayLayer: PipFrames.shared.display, playbackDelegate: self)
        let made = AVPictureInPictureController(contentSource: source)
        made.delegate = self
        made.requiresLinearPlayback = false
        controller = made
    }

    func start() {
        make()
        attempt(0)
    }

    func arm(_ on: Bool) {
        armed = on
        guard AVPictureInPictureController.isPictureInPictureSupported() else { return }
        if on {
            make()
            if controller?.isPictureInPictureActive != true {
                PipFrames.shared.paused = false
                PipFrames.shared.placeholder()
            }
            refresh()
        }
        controller?.canStartPictureInPictureAutomaticallyFromInline = on
    }

    private func attempt(_ tries: Int) {
        guard let controller else {
            wistvPipStarted(false)
            return
        }
        if controller.isPictureInPictureActive {
            wistvPipStarted(true)
        } else if controller.isPictureInPicturePossible {
            controller.startPictureInPicture()
        } else if tries >= 30 {
            wistvPipStarted(false)
        } else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { self.attempt(tries + 1) }
        }
    }

    func stop() {
        restored = true
        controller?.stopPictureInPicture()
    }

    func refresh() {
        controller?.invalidatePlaybackState()
    }

    func pictureInPictureControllerWillStartPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        restored = false
        DispatchQueue.global(qos: .userInitiated).async { wistvPipAuto() }
    }

    func pictureInPictureControllerDidStartPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        wistvPipStarted(true)
    }

    func pictureInPictureController(_ pictureInPictureController: AVPictureInPictureController, failedToStartPictureInPictureWithError error: Error) {
        wistvPipStarted(false)
    }

    func pictureInPictureController(_ pictureInPictureController: AVPictureInPictureController, restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void) {
        restored = true
        completionHandler(true)
    }

    func pictureInPictureControllerDidStopPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        let back = restored
        PipFrames.shared.display.flushAndRemoveImage()
        if armed {
            PipFrames.shared.placeholder()
        }
        DispatchQueue.global(qos: .userInitiated).async { wistvPipStopped(back) }
    }

    func pictureInPictureController(_ pictureInPictureController: AVPictureInPictureController, setPlaying playing: Bool) {
        PipFrames.shared.paused = !playing
        DispatchQueue.global(qos: .userInitiated).async { wistvPipPlay(playing) }
    }

    func pictureInPictureControllerTimeRangeForPlayback(_ pictureInPictureController: AVPictureInPictureController) -> CMTimeRange {
        CMTimeRange(start: .negativeInfinity, duration: .positiveInfinity)
    }

    func pictureInPictureControllerIsPlaybackPaused(_ pictureInPictureController: AVPictureInPictureController) -> Bool {
        PipFrames.shared.paused
    }

    func pictureInPictureController(_ pictureInPictureController: AVPictureInPictureController, didTransitionToRenderSize newRenderSize: CMVideoDimensions) {}

    func pictureInPictureController(_ pictureInPictureController: AVPictureInPictureController, skipByInterval skipInterval: CMTime, completion completionHandler: @escaping () -> Void) {
        let seconds = CMTimeGetSeconds(skipInterval)
        DispatchQueue.global(qos: .userInitiated).async { wistvPipSkip(seconds) }
        completionHandler()
    }
}

@_cdecl("wistv_pip_supported")
public func wistvPipSupported() -> Bool {
    AVPictureInPictureController.isPictureInPictureSupported()
}

@_cdecl("wistv_pip_start")
public func wistvPipStart() {
    DispatchQueue.main.async { PipControl.shared.start() }
}

@_cdecl("wistv_pip_close")
public func wistvPipClose() {
    DispatchQueue.main.async { PipControl.shared.stop() }
}

@_cdecl("wistv_pip_paused")
public func wistvPipPaused(_ paused: Bool) {
    PipFrames.shared.paused = paused
    DispatchQueue.main.async { PipControl.shared.refresh() }
}

@_cdecl("wistv_pip_frame_begin")
public func wistvPipFrameBegin(_ width: Int32, _ height: Int32, _ stride: UnsafeMutablePointer<Int>) -> UnsafeMutableRawPointer? {
    PipFrames.shared.begin(Int(width), Int(height), stride)
}

@_cdecl("wistv_pip_frame_end")
public func wistvPipFrameEnd(_ ok: Bool) {
    PipFrames.shared.end(ok)
}

final class VideoPlugin: Plugin {
    private let video = VideoView(frame: .zero)
    private var pointer = 0
    private var savedBrightness: CGFloat?

    override func load(webview: WKWebView) {
        webview.isOpaque = false
        webview.backgroundColor = .clear
        webview.scrollView.backgroundColor = .clear
        video.backgroundColor = .black
        video.isUserInteractionEnabled = false
        video.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        if let layer = video.layer as? CAMetalLayer {
            layer.contentsScale = UIScreen.main.nativeScale
            layer.framebufferOnly = true
            layer.backgroundColor = UIColor.black.cgColor
        }
        pointer = Int(bitPattern: Unmanaged.passUnretained(video.layer).toOpaque())
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        try? AVAudioSession.sharedInstance().setActive(true)
        NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.restoreBrightness()
        }
        NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { note in
            guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            if type == .began {
                wistvAudioInterrupted()
            } else {
                try? AVAudioSession.sharedInstance().setActive(true)
            }
        }
        place(webview, tries: 0)
    }

    private func place(_ webview: WKWebView, tries: Int) {
        guard let host = webview.superview else {
            if tries < 50 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { self.place(webview, tries: tries + 1) }
            }
            return
        }
        video.frame = host.bounds
        host.insertSubview(video, belowSubview: webview)
        let pip = PipFrames.shared.view
        pip.frame = host.bounds
        host.insertSubview(pip, belowSubview: video)
        Orientation.install(from: host)
        Orientation.apply(Orientation.mask)
    }

    @objc public func layer(_ invoke: Invoke) {
        invoke.resolve(["pointer": pointer])
    }

    @objc public func layerSize(_ invoke: Invoke) {
        DispatchQueue.main.async {
            self.video.layoutIfNeeded()
            var out: [String: Any] = ["width": Double(self.video.bounds.width), "height": Double(self.video.bounds.height), "gravity": self.video.layer.contentsGravity.rawValue]
            if let metal = self.video.layer as? CAMetalLayer {
                out["drawableWidth"] = Double(metal.drawableSize.width)
                out["drawableHeight"] = Double(metal.drawableSize.height)
            }
            invoke.resolve(out)
        }
    }

    @objc public func gravity(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(AwakeArgs.self)
        DispatchQueue.main.async {
            self.video.contentMode = args.on ? .scaleToFill : .scaleAspectFit
            self.video.layer.contentsGravity = args.on ? .resize : .resizeAspect
            invoke.resolve()
        }
    }

    private func restoreBrightness() {
        guard let saved = savedBrightness else { return }
        UIScreen.main.brightness = saved
        savedBrightness = nil
    }

    @objc public func brightness(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(LevelArgs.self)
        DispatchQueue.main.async {
            if args.level >= 0 {
                if self.savedBrightness == nil { self.savedBrightness = UIScreen.main.brightness }
                UIScreen.main.brightness = CGFloat(min(1, max(0.01, args.level)))
            } else if args.level > -1.5 {
                self.restoreBrightness()
            }
            invoke.resolve(["level": Double(UIScreen.main.brightness)])
        }
    }

    @objc public func battery(_ invoke: Invoke) {
        DispatchQueue.main.async {
            let device = UIDevice.current
            device.isBatteryMonitoringEnabled = true
            var out: [String: Any] = ["charging": device.batteryState == .charging || device.batteryState == .full]
            if device.batteryLevel >= 0 {
                out["level"] = Double(device.batteryLevel)
            }
            invoke.resolve(out)
        }
    }

    @objc public func awake(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(AwakeArgs.self)
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = args.on
            PipControl.shared.arm(args.on)
            invoke.resolve()
        }
    }

    @objc public func landscape(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(AwakeArgs.self)
        DispatchQueue.main.async {
            Orientation.apply(args.on ? .landscape : .portrait)
            invoke.resolve()
        }
    }

    @objc public func open(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(OpenArgs.self)
        guard let url = URL(string: args.url) else {
            invoke.reject("Liên kết không hợp lệ")
            return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url)
            invoke.resolve()
        }
    }
}

@_cdecl("init_plugin_wistv_video")
func initPlugin() -> Plugin {
    return VideoPlugin()
}
