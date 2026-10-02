import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
const path=name=>fileURLToPath(new URL(name,import.meta.url));
export default defineConfig({root:path('./'),plugins:[react()],resolve:{alias:[
 {find:/^(?:\.\.\/)+context\/AppDataContext$/,replacement:path('./contexts.ts')},
 {find:/^(?:\.\.\/)+context\/LiveContext$/,replacement:path('./contexts.ts')},
 {find:/^(?:\.\.\/)+context\/CommentCaptureContext$/,replacement:path('./contexts.ts')},
 {find:/^\.\.\/\.\.\/services\/sellerAnalysisApi$/,replacement:path('./api.ts')},
]},server:{host:'127.0.0.1',port:5187,strictPort:true,fs:{allow:[path('../../../')]}}});
