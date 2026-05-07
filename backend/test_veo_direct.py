import requests
import json

url = "http://192.168.5.101:8000/v1/chat/completions"
headers = {
    "Authorization": "Bearer han1234",
    "Content-Type": "application/json"
}

long_prompt = "高清流畅跟拍视频，带有极快语速、充满激情的原生音频。极度写实。一位身材微胖、肤色健康的年轻墨西哥女性，正迎着镜头走在热闹的墨西哥海滨木栈道上。她穿着黑色的紧身迷你裙：不对称的单侧肩带、腰部性感的半透明黑色网纱拼接、紧密的横向褶皱裙身、大腿侧边带有抽绳。裙子随走动自然贴合身体曲线，毫无变形。背景是虚化的大量大众游客在散步，充满烟火气。画面同步伴有她热情洋溢、语速极快的墨西哥西班牙语口播说话声：“¡Hola chicas! ¡Rápido, miren esta belleza! ¡El vestido negro perfecto para nosotras las latinas! ¡Esa malla en la cintura es una locura, te hace un cuerpazo al instante! ¡Póntelo y sé la mamacita más ardiente de la playa, cómpralo ya, ya, ya!”"

payload = {
    "model": "veo_t2v_ultra",
    "messages": [
        {"role": "user", "content": long_prompt}
    ],
    "stream": False
}

try:
    response = requests.post(url, json=payload, headers=headers)
    print(f"Status Code: {response.status_code}")
    print(f"Response: {response.text}")
except Exception as e:
    print(f"Error: {e}")
