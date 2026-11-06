# Renders a high-res base map (own work from Natural Earth/GSHHS data bundled with basemap) + geo->pixel transform
import json, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from mpl_toolkits.basemap import Basemap
LON0,LON1,LAT0,LAT1=0,48,5,56
W=6000
m=Basemap(projection="merc",llcrnrlon=LON0,urcrnrlon=LON1,llcrnrlat=LAT0,urcrnrlat=LAT1,resolution="i")
H=int(round(W*m.ymax/m.xmax))
fig=plt.figure(figsize=(W/200,H/200),dpi=200)
ax=fig.add_axes([0,0,1,1]); m.ax=ax
m.drawmapboundary(fill_color="#1c2a33",linewidth=0)
m.fillcontinents(color="#c8a06a",lake_color="#1c2a33")
m.drawcountries(color="#6b4a2a",linewidth=1.2)
m.drawcoastlines(color="#3d2a18",linewidth=1.0)
import numpy as np
from matplotlib.collections import LineCollection
rv=m.drawrivers(color="#2f6f8f",linewidth=0)
segs=[sg for sg in rv.get_segments() if len(sg)]
keep=[]
for sg in segs:
    lo,la=m(sg[:,0],sg[:,1],inverse=True)
    if lo.min()>29 and lo.max()<35.5 and la.min()>12.5 and la.max()<31.6: keep.append(sg)
rv.remove()
ax.add_collection(LineCollection(keep,colors="#2a7aa0",linewidths=5,zorder=5))
ax.set_xlim(0,m.xmax); ax.set_ylim(0,m.ymax)
ax.set_axis_off()
out="/workspace/Flare-Studio/wain_eldahab/EXTERNAL_RESEARCH/MAPS/base_map.png"
fig.savefig(out,dpi=200)
pts={"meroe":(33.749,16.938),"khartoum":(32.5599,15.5007),"berlin":(13.405,52.52),"munich":(11.575,48.137),"cairo":(31.2357,30.0444)}
px={}
x0,y0=m(LON0,LAT0); x1,y1=m(LON1,LAT1)
for k,(lo,la) in pts.items():
    x,y=m(lo,la); px[k]=((x-x0)/(x1-x0)*W, (1-(y-y0)/(y1-y0))*H)
json.dump({"W":W,"H":H,"px":px},open(out.replace(".png",".json"),"w"),indent=1)
print(W,H,px)
