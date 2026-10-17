import json, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager as fm
from matplotlib.patches import FancyBboxPatch
import numpy as np
for f in ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc','/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc']:
    fm.fontManager.addfont(f)
plt.rcParams['font.family']='Noto Sans CJK SC'
plt.rcParams['axes.unicode_minus']=False
plt.rcParams['font.size']=10.5
AMBER='#E9A23B'; BLUE='#3D8FD6'; NAVY='#2A4F86'; RED='#CC3333'; GRAY='#8A94A6'; LIGHT='#DCE6F2'; ORANGE='#C96A10'; GREEN='#2F8A5E'
D=json.load(open('data.json'))
R=json.load(open('../04_原型系统源码/test/results.json'))
A=json.load(open('../04_原型系统源码/test/ablation.json'))
P=np.array(D['P']); W=np.array(D['W']); prof=D['prof']; bg=D['model']['bg']
def clean(ax):
    for s in ['top','right']: ax.spines[s].set_visible(False)
    ax.spines['left'].set_color('#999'); ax.spines['bottom'].set_color('#999')
def save(fig,name):
    fig.savefig('fig/'+name, dpi=200, bbox_inches='tight'); plt.close(fig)

# 图1 老龄人口
fig,ax=plt.subplots(figsize=(6.2,2.8))
labels=['60 周岁及以上','65 周岁及以上','独居老人（估算）']; vals=[3.2338,2.2365,0.46]
bars=ax.barh(labels[::-1], vals[::-1], color=[GRAY,NAVY,NAVY][::-1], height=.55)
bars[0].set_color(AMBER)
for b,v,t in zip(bars, vals[::-1], ['约 4600 万','2.24 亿（15.9%）','3.23 亿（23.0%）']):
    ax.text(v+0.05, b.get_y()+b.get_height()/2, t, va='center')
ax.set_xlim(0,4.1); ax.set_xlabel('亿人'); clean(ax)
ax.set_title('我国老年人口规模（2025 年末）', loc='left', fontsize=11)
save(fig,'f1_population.png')

# 图2 系统架构
fig,ax=plt.subplots(figsize=(7.6,3.6)); ax.axis('off'); ax.set_xlim(0,100); ax.set_ylim(0,50)
def box(x,y,w,h,title,lines,fc):
    ax.add_patch(FancyBboxPatch((x,y),w,h,boxstyle='round,pad=0.4,rounding_size=1.2',fc=fc,ec='#7a8699',lw=1))
    ax.text(x+w/2,y+h-3.2,title,ha='center',va='top',fontsize=11,fontweight='bold')
    for i,l in enumerate(lines): ax.text(x+w/2,y+h-8.5-i*4.4,l,ha='center',va='top',fontsize=9)
box(2,8,26,36,'采集层',['智能电表：15 分钟用电量','远传水表：15 分钟用水量','用户授权接入','户内不装任何新设备'],'#FFF4DE')
box(36,8,28,36,'社区边缘计算',['个人基线：每晚重学 28 天','静默画像 · 情境判断','大功率 / 持续用水','起夜 · 作息偏离','原始数据不出社区'],'#E3ECF8')
box(72,8,26,36,'分级处置',['关注：AI 自动外呼确认','紧急：家属 + 网格员','家属端：每日平安','处置结果回流调参'],'#FBE6E3')
for x in [29.5,65.5]: ax.annotate('',xy=(x+5,26),xytext=(x,26),arrowprops=dict(arrowstyle='-|>',color='#555',lw=1.4))
ax.text(50,3,'只传输“15 分钟总量”两条曲线，不含图像、声音、位置',ha='center',fontsize=9,color='#555')
save(fig,'f2_arch.png')

# 图3 一天曲线（正常日）
day=30; s0=day*96
fig,ax=plt.subplots(figsize=(7.4,3.0))
x=np.arange(96)/4
ax.fill_between(x, prof['p10'], prof['p90'], color=LIGHT, step='mid', label='个人常见范围（近 28 天 10%–90%）')
ax.plot(x, P[s0:s0+96], color=AMBER, lw=1.8, drawstyle='steps-mid', label='当天用电')
ax2=ax.twinx(); ax2.bar(x, W[s0:s0+96], width=.22, color=BLUE, alpha=.8, label='当天用水'); ax2.set_ylim(0, max(W[s0:s0+96])*3.2); ax2.set_ylabel('用水（升/15 分钟）',color=BLUE); ax2.spines['top'].set_visible(False)
ax.set_xlim(0,24); ax.set_xticks(range(0,25,3)); ax.set_xticklabels([f'{h}时' for h in range(0,25,3)])
ax.set_ylabel('平均功率（kW）'); clean(ax)
h1,l1=ax.get_legend_handles_labels(); h2,l2=ax2.get_legend_handles_labels(); ax.legend(h1+h2,l1+l2,loc='upper left',fontsize=8.5,frameon=False)
ax.set_title(f"一位独居老人一天的用电与用水（模拟数据）", loc='left', fontsize=11)
save(fig,'f3_day.png')

# 图4 作息指纹
act=np.array(D['act'])
from matplotlib.colors import ListedColormap, BoundaryNorm
cmap=ListedColormap(['#F1F3F6','#F6DDB0',AMBER,BLUE]); norm=BoundaryNorm([-0.1,0.2,0.7,1.5,2.5],cmap.N)
fig,ax=plt.subplots(figsize=(7.4,2.9))
ax.imshow(act, aspect='auto', cmap=cmap, norm=norm, extent=[0,24,len(act),0], interpolation='nearest')
ax.set_xticks(range(0,25,3)); ax.set_xticklabels([f'{h}时' for h in range(0,25,3)]); ax.set_ylabel('近 28 天'); ax.set_yticks([0.5,27.5]); ax.set_yticklabels(['4 周前','昨天'])
from matplotlib.patches import Patch
ax.legend(handles=[Patch(color=AMBER,label='开关电器'),Patch(color=BLUE,label='用水'),Patch(color='#F6DDB0',label='有电器开着')],loc='upper center',bbox_to_anchor=(.5,-.14),ncol=3,frameon=False,fontsize=8.5)
ax.set_title('“作息指纹”：系统为每位老人学出的个人基线', loc='left', fontsize=11)
save(fig,'f4_print.png')

# 图5 夜间跌倒案例
tr=D['truth'][0]; on=tr['onset']//15; a=[x for x in D['alerts'] if x['k']>=on][0]
wake=int(round(D['model']['wakeQ95'])); wk=(on//96 + (0 if on%96<48 else 1))*96+wake
st=on-28; en=wk+8
fig,ax=plt.subplots(figsize=(7.4,2.9))
xx=np.arange(st,en)
def lab(k): return '%02d:%02d'%((k%96)//4,(k%96)%4*15)
ax.plot(xx, P[st:en], color=AMBER, lw=1.8, drawstyle='steps-mid', label='用电')
ax.bar(xx, W[st:en]/100, width=.6, color=BLUE, label='用水（÷100）')
ax.axvline(on, color=GRAY, ls='--', lw=1); ax.text(on+.5, ax.get_ylim()[1]*.92, '起夜时跌倒\n卫生间灯一直亮着', fontsize=8.5, color='#444', va='top')
ax.axvline(a['k'], color=RED, lw=1.6); ax.text(a['k']+.5, ax.get_ylim()[1]*.55, '系统报警（紧急）\n'+lab(a['k']), fontsize=8.5, color=RED)
ax.axvline(wk, color=GREEN, ls=':', lw=1.4); ax.text(wk+.5, ax.get_ylim()[1]*.3, '平时 95% 的日子\n在此前起床', fontsize=8.5, color=GREEN)
ticks=list(range(st - st%8 + 8, en, 8)); ax.set_xticks(ticks); ax.set_xticklabels([lab(k) for k in ticks])
ax.set_ylabel('kW'); clean(ax); ax.legend(loc='upper left',fontsize=8.5,frameon=False)
ax.set_title('案例：夜间起夜跌倒（模拟数据），系统在老人平时起床之前就发出紧急预警', loc='left', fontsize=10.5)
save(fig,'f5_case.png')

# 图6 分类型检出
pt=R['perType']; keys=list(pt.keys())
names=[pt[k]['name'] for k in keys]; rec=[pt[k]['recall']*100 for k in keys]; med=[pt[k]['medianDelayH'] for k in keys]
fig,ax=plt.subplots(figsize=(7.4,3.2))
y=np.arange(len(keys))[::-1]
cols=[NAVY]*6+[ORANGE]*2
ax.barh(y, rec, color=cols, height=.55)
for yi,r,k in zip(y,rec,keys):
    m=pt[k]['medianDelayH']; t=f"{r:.1f}%（n={pt[k]['n']}）"
    ax.text(r+1, yi, t, va='center', fontsize=8.5)
ax.set_yticks(y); ax.set_yticklabels(names); ax.set_xlim(0,125); ax.set_xticks([0,25,50,75,100]); ax.set_xlabel('检出率 %'); clean(ax)
ax.set_title('留出测试集（100 户 × 62 天）各类事件检出率', loc='left', fontsize=11)
save(fig,'f6_recall.png')

# 图7 对比
sel=[x for x in A if x['key'] in ('full','noPersonal','elecOnly','rule')]
nm={'full':'本方法','noPersonal':'去掉个人基线','elecOnly':'只用电表','rule':'固定阈值规则'}
fig,axs=plt.subplots(1,3,figsize=(7.6,2.7))
for ax,key,tt,fmt in zip(axs,['dangerRecall','dangerMedianDelayH','redFA'],['危险事件检出率','中位检出时间（小时）','紧急误报（次/户·月）'],['{:.0%}','{:.1f}','{:.2f}']):
    v=[x[key] for x in sel]; c=[NAVY if x['key']=='full' else '#AEB8C7' for x in sel]
    ax.bar(range(len(sel)), v, color=c, width=.6)
    for i,vv in enumerate(v): ax.text(i, vv*1.02, fmt.format(vv), ha='center', fontsize=8)
    ax.set_xticks(range(len(sel))); ax.set_xticklabels([nm[x['key']] for x in sel], rotation=30, ha='right', fontsize=8.5)
    ax.set_title(tt, fontsize=10); clean(ax); ax.set_yticks([])
    ax.set_ylim(0, max(v)*1.18)
fig.tight_layout()
save(fig,'f7_compare.png')
print('ok')
