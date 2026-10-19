; After installing or updating, tell Explorer that file associations and icons changed (SHCNE_ASSOCCHANGED), so the
; Start menu and taskbar drop the cached icon of an older version instead of keeping it until the next sign-in.
!macro customInstall
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
