Pod::Spec.new do |s|
  s.name           = 'MediaExtract'
  s.version        = '1.0.0'
  s.summary        = 'On-device video OCR + voiceover extraction'
  s.description    = 'Samples video frames for Vision OCR and transcribes audio via SFSpeechRecognizer, fully on-device.'
  s.author         = 'Napkin'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
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
