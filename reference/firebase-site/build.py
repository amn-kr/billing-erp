#!/usr/bin/env python3
"""Builds public/app.html from the app (billing-dashboard.html) + the web-version pieces."""
import os,sys
HERE=os.path.dirname(os.path.abspath(__file__))
src=sys.argv[1] if len(sys.argv)>1 else os.path.join(HERE,'..','billing-dashboard.html')
h=open(src,encoding='utf-8').read()
shim=open(os.path.join(HERE,'src','shim.js'),encoding='utf-8').read()
ui=open(os.path.join(HERE,'src','saas-ui.js'),encoding='utf-8').read()
FB='''<script src="https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.5/firebase-auth-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore-compat.js"></script>
<script src="firebase-config.js"></script>
'''
i=h.index('<script>')
h=h[:i]+FB+'<script>'+shim+'</script>\n'+h[i:]
e=h.rindex('</script>')
h=h[:e]+'\n'+ui+'\n'+h[e:]
head='<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n'
# the artifact file starts with <title>/<style>; give it a proper document shell
t=h.index('</style>')+len('</style>')
h=head+h[:t]+'\n</head><body>\n'+h[t:]+'\n</body></html>\n'
h=h.replace('<title>Billing ERP – Dashboard</title>','<title>Billing ERP</title>',1)
out=os.path.join(HERE,'public','app.html')
open(out,'w',encoding='utf-8').write(h)
print('built',out,len(h)//1024,'KB')
