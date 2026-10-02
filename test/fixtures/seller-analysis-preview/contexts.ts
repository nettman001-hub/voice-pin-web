export const useAppData=()=>({allMembers:[{id:'seller',nickname:'테스트 판매자',email:'seller@example.test',role:'판매자'}],refreshMembers:async()=>true});
export const useLive=()=>({isListening:false,sttProvider:'SONIOX',sonioxApiKey:'',deepgramApiKey:''});
export const useCommentCapture=()=>({isActive:false,config:{serverUrl:'http://127.0.0.1:3001'}});
