Pod::Spec.new do |s|
  s.name           = 'MediaExtract'
  s.version        = '1.0.0'
  s.summary        = 'On-device video OCR + voiceover extraction'
  s.description    = 'Samples video frames for Vision OCR and transcribes audio via SFSpeechRecognizer, fully on-device.'
  s.author         = 'Napkin'
  s.homepage       = 'https://docs.expo.dev/modules/'
  # Must be <= the app's iOS deployment target (15.1) — a higher floor makes
  # autolinking silently SKIP this module as "unsupported platform" (that was the
  # b35 launch crash: unlinked module → requireNativeModule threw at import).
  s.platforms      = {
    :ios => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
