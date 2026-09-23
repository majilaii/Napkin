// Renders the native launch-screen wordmark: "Napkin" in Newsreader Regular,
// 42pt with -1pt tracking (Type.displayLarge), ink #1c1c19, on a transparent
// square canvas. The launch screen (components/launch/LaunchScreen.tsx) draws
// the same PNG at the same size, so the native splash hands off to the animated
// screen without a visible jump.
//
// Usage (from the repository root):
//   swift scripts/brand/render-splash-wordmark.swift
//
// Writes napkin-app/assets/images/splash-wordmark.png at @3x. Expo's
// splash-screen plugin derives the @1x/@2x launch assets from it.

import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

let scale: CGFloat = 3
// Keep in sync with SPLASH_WORDMARK_SIZE in components/launch/launchLayout.ts
// and imageWidth in napkin-app/app.config.ts.
let canvasPoints: CGFloat = 200
let fontPoints: CGFloat = 42
let trackingPoints: CGFloat = -1
let ink = CGColor(srgbRed: 0x1c / 255, green: 0x1c / 255, blue: 0x19 / 255, alpha: 1)

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let fontURL = root.appendingPathComponent(
    "napkin-app/node_modules/@expo-google-fonts/newsreader/400Regular/Newsreader_400Regular.ttf"
)
let outputURL = root.appendingPathComponent("napkin-app/assets/images/splash-wordmark.png")

guard
    let descriptors = CTFontManagerCreateFontDescriptorsFromURL(fontURL as CFURL) as? [CTFontDescriptor],
    let descriptor = descriptors.first
else {
    fatalError("Newsreader not found at \(fontURL.path). Run npm ci in napkin-app first.")
}

let font = CTFontCreateWithFontDescriptor(descriptor, fontPoints * scale, nil)
let attributes: [CFString: Any] = [
    kCTFontAttributeName: font,
    kCTKernAttributeName: trackingPoints * scale,
    kCTForegroundColorAttributeName: ink,
]
let text = CFAttributedStringCreate(nil, "Napkin" as CFString, attributes as CFDictionary)!
let line = CTLineCreateWithAttributedString(text)

// Center the ink optically: horizontally on the glyph bounds, vertically on the
// band between the tallest ascender and the baseline. The descender of "p"
// hangs below, as it does in the auth masthead.
let inkBounds = CTLineGetBoundsWithOptions(line, .useGlyphPathBounds)
let pixels = Int(canvasPoints * scale)
let x = (CGFloat(pixels) - inkBounds.width) / 2 - inkBounds.minX
let bandHeight = inkBounds.maxY
let baselineFromBottom = (CGFloat(pixels) - bandHeight) / 2

guard let context = CGContext(
    data: nil,
    width: pixels,
    height: pixels,
    bitsPerComponent: 8,
    bytesPerRow: 0,
    space: CGColorSpace(name: CGColorSpace.sRGB)!,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
) else {
    fatalError("Could not create the bitmap context.")
}
context.setAllowsFontSmoothing(false)
context.setShouldSmoothFonts(false)
context.setAllowsAntialiasing(true)
context.setShouldAntialias(true)
context.textPosition = CGPoint(x: x, y: baselineFromBottom)
CTLineDraw(line, context)

guard
    let image = context.makeImage(),
    let destination = CGImageDestinationCreateWithURL(outputURL as CFURL, UTType.png.identifier as CFString, 1, nil)
else {
    fatalError("Could not encode the PNG.")
}
CGImageDestinationAddImage(destination, image, nil)
guard CGImageDestinationFinalize(destination) else {
    fatalError("Could not write \(outputURL.path).")
}

// Geometry the launch screen needs, in points from the canvas center (y down).
let inkTop = (CGFloat(pixels) / 2 - (baselineFromBottom + inkBounds.maxY)) / scale
let baseline = (CGFloat(pixels) / 2 - baselineFromBottom) / scale
let inkBottom = (CGFloat(pixels) / 2 - (baselineFromBottom + inkBounds.minY)) / scale
print(String(format: "wrote %@ (%dx%d px)", outputURL.lastPathComponent, pixels, pixels))
print(String(format: "ink width %.2fpt, ink top %.2fpt, baseline %.2fpt, ink bottom %.2fpt (from center, y down)",
             inkBounds.width / scale, inkTop, baseline, inkBottom))
