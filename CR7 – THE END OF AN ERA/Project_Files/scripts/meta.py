import sys, json, re, time, urllib.request
sys.path.insert(0,'.'); from commons import api, UA
titles=[l.strip() for l in open(sys.argv[1]) if l.strip()]
out=[]
for i in range(0,len(titles),20):
    d=api(dict(action="query",titles="|".join(titles[i:i+20]),prop="imageinfo",iiprop="url|size|mime|extmetadata",iiurlwidth=330,
        iiextmetadatafilter="LicenseShortName|LicenseUrl|Artist|Credit|DateTimeOriginal|ImageDescription|AttributionRequired"))
    for p in d["query"]["pages"].values():
        ii=p["imageinfo"][0]; m={k:re.sub("<[^>]+>","",v.get("value","")).strip() for k,v in ii["extmetadata"].items()}
        out.append(dict(title=p["title"],url=ii["url"],thumb=ii["thumburl"],page=ii["descriptionurl"],w=ii["width"],h=ii["height"],**m))
    time.sleep(2)
json.dump(out,open(sys.argv[2],"w"),ensure_ascii=False,indent=1)
for k,o in enumerate(out):
    fn=f"thumbs/{k:02d}.jpg"
    urllib.request.urlretrieve if False else None
    r=urllib.request.Request(o["thumb"],headers=UA); open(fn,"wb").write(urllib.request.urlopen(r,timeout=30).read()); time.sleep(1.0)
    print(k, o["title"][5:70], "|", o.get("LicenseShortName"), "|", o.get("ImageDescription","")[:110].replace("\n"," "))
