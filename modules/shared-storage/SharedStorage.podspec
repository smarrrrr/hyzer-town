require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = 'SharedStorage'
  s.version      = package['version']
  s.summary      = 'Local module for App Group shared container access'
  s.homepage     = 'https://github.com/placeholder'
  s.license      = 'MIT'
  s.author       = 'Hyzer Town'
  s.source       = { :git => '' }
  s.platforms    = { :ios => '16.4' }
  s.swift_version = '5.0'
  s.source_files = 'ios/**/*.swift'
  s.dependency 'ExpoModulesCore'
  s.static_framework = true
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
