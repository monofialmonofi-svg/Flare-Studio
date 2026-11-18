import json, sys, time, urllib.request, urllib.parse, urllib.error
UA={"User-Agent":"FlareStudio-AssetFetcher/1.0 (video production research)"}
def api(params):
    params.update(format="json")
    r=urllib.request.Request("https://commons.wikimedia.org/w/api.php?"+urllib.parse.urlencode(params),headers=UA)

    for k in range(6):
        try:
            return json.load(urllib.request.urlopen(r,timeout=30))
        except urllib.error.HTTPError as e:
            if e.code != 429: raise
            time.sleep(int(e.headers.get("Retry-After") or 0) or 5 * 2 ** k)
    raise RuntimeError("rate limited")
def search(q, n=40, mime=None):
    d=api(dict(action="query",generator="search",gsrsearch=q,gsrnamespace=6,gsrlimit=n,prop="imageinfo",iiprop="url|size|mime|extmetadata",iiextmetadatafilter="LicenseShortName|Artist|DateTimeOriginal|ImageDescription"))
    out=[]
    for p in (d.get("query",{}).get("pages",{}) or {}).values():
        ii=p["imageinfo"][0]; m=ii.get("extmetadata",{})
        if mime and not ii["mime"].startswith(mime): continue
        out.append(dict(title=p["title"],w=ii.get("width"),h=ii.get("height"),mime=ii["mime"],url=ii["url"],page=ii["descriptionurl"],
            lic=m.get("LicenseShortName",{}).get("value",""),artist=m.get("Artist",{}).get("value","")[:80],date=m.get("DateTimeOriginal",{}).get("value","")[:20]))
    return out
if __name__=="__main__":
    q=sys.argv[1]; mime=sys.argv[2] if len(sys.argv)>2 else None
    for r in sorted(search(q,50,mime),key=lambda r:-(r["w"] or 0)*(r["h"] or 0)):
        print(f'{r["w"]}x{r["h"]} | {r["lic"]} | {r["date"]} | {r["title"]}')
