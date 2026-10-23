"""将已渲染汇报页与macOS中文合成语音制作成方案解说视频。不是软件录屏。"""
from pathlib import Path
import json,subprocess,shutil
R=Path(__file__).resolve().parents[1];B=R/'.work/video';B.mkdir(parents=True,exist_ok=True)
O=R/'deliverables/演示';jobs=json.loads((O/'解说词.json').read_text())
ff=shutil.which('ffmpeg');probe=shutil.which('ffprobe')
assert ff and probe,'need ffmpeg/ffprobe'
def run(args):subprocess.run(args,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
receipt=[]
for j in jobs:
 n=j['slide'];t=B/f'{n:02}.txt';a=B/f'{n:02}.aiff';v=B/f'{n:02}.mp4'
 t.write_text(j['text'])
 run(['/usr/bin/say','-v','Tingting','-r','205','-f',str(t),'-o',str(a)])
 duration=float(subprocess.check_output([probe,'-v','error','-show_entries','format=duration','-of','csv=p=0',str(a)]))+0.5
 run([ff,'-y','-v','error','-loop','1','-framerate','25','-i',str(R/f'.work/deck/slide-{n:02}.png'),'-i',str(a),'-af','apad=pad_dur=0.5,loudnorm=I=-18:TP=-2:LRA=7','-t',f'{duration:.4f}','-c:v','libx264','-preset','veryfast','-tune','stillimage','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-ar','48000','-ac','2',str(v)])
 receipt.append({'slide':n,'duration':duration,'file':v.name})
 print(f'video segment {n}/10 ready',flush=True)
(B/'concat.txt').write_text(''.join(f"file '{x['file']}'\n" for x in receipt))
final=O/'数智选材_方案解说.mp4'
run([ff,'-y','-v','error','-f','concat','-safe','0','-i',str(B/'concat.txt'),'-c','copy','-movflags','+faststart',str(final)])
run([ff,'-v','error','-i',str(final),'-f','null','-'])
(B/'receipt.json').write_text(json.dumps({'voice':'macOS Tingting synthetic voice','rate':205,'type':'narrated slides, not screen capture','segments':receipt},ensure_ascii=False,indent=2))
print(final)
