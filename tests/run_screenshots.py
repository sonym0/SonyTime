from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import threading
from playwright.sync_api import sync_playwright

root=Path('/mnt/data/SonyTimeAndroidV11').resolve(); out=root/'tests'/'screenshots'; out.mkdir(parents=True,exist_ok=True)
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',8765), Quiet)
server.RequestHandlerClass.directory=str(root)
thread=threading.Thread(target=server.serve_forever,daemon=True); thread.start()
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':412,'height':915}, device_scale_factor=1, accept_downloads=True)
    page.goto('http://127.0.0.1:8765/preview/', wait_until='load')
    page.evaluate("localStorage.clear(); location.reload()")
    page.wait_for_timeout(500)
    page.screenshot(path=str(out/'01-home.png'), full_page=True)
    page.click('#bin'); page.wait_for_timeout(400)
    page.screenshot(path=str(out/'02-after-attendance.png'), full_page=True)
    page.click('#bout'); page.wait_for_timeout(400)
    page.screenshot(path=str(out/'03-after-departure.png'), full_page=True)
    page.screenshot(path=str(out/'04-log.png'), full_page=True)
    with page.expect_download() as dlinfo:
        page.click('#xl')
    dl=dlinfo.value
    downloaded=out/'Sony-time-preview-2026-09.xlsx'; dl.save_as(str(downloaded))
    page.wait_for_timeout(300)
    page.screenshot(path=str(out/'05-export-confirmation.png'), full_page=True)
    browser.close()
server.shutdown()
print('screenshots:', sorted(x.name for x in out.glob('*.png')))
print('xlsx:', downloaded, downloaded.stat().st_size)
