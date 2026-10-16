import sys
from PIL import Image, ImageDraw, ImageFont
W,H=2500,1686; cw,ch=W//3,H//2
img=Image.new('RGB',(W,H),'#fff5f7'); d=ImageDraw.Draw(img)
F=lambda s,b=True: ImageFont.truetype('C:/Windows/Fonts/msjhbd.ttc' if b else 'C:/Windows/Fonts/msjh.ttc', s)
E=ImageFont.truetype('C:/Windows/Fonts/seguiemj.ttf',109)
items=[('📅','婚禮資訊','時間・地點・導航','#ffe3ea'),('🪑','查座位','輸入名字查桌號','#fff0d9'),('🚗','交通停車','怎麼去・停哪裡','#e3f1ff'),
       ('💌','回覆出席','填寫出席意願','#f0e6ff'),('💐','送上祝福','留言給新人','#e2f7ea'),('📸','上傳照片','一起記錄這天','#fff9d6')]
for i,(emo,title,sub,bg) in enumerate(items):
    x,y=(i%3)*cw,(i//3)*ch; m=26
    d.rounded_rectangle([x+m,y+m,x+cw-m,y+ch-m],radius=60,fill=bg,outline='#f3b6c6',width=6)
    cx=x+cw//2
    # emoji: render at 109 then scale up
    e=Image.new('RGBA',(160,160),(0,0,0,0)); ImageDraw.Draw(e).text((80,80),emo,font=E,embedded_color=True,anchor='mm')
    e=e.resize((300,300),Image.LANCZOS); img.paste(e,(cx-150,y+110),e)
    d.text((cx,y+520),title,font=F(120),fill='#7a3d52',anchor='mm')
    d.text((cx,y+660),sub,font=F(64,False),fill='#a0687a',anchor='mm')
img.save(sys.argv[1],optimize=True)
