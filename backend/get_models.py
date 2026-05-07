import requests

url = "http://192.168.5.101:8000/v1/models"
headers = {"Authorization": "Bearer han1234"}

try:
    response = requests.get(url, headers=headers)
    print("Status:", response.status_code)
    data = response.json()
    if 'data' in data:
        models = [m['id'] for m in data['data'] if 'veo' in m['id'].lower()]
        print("Veo Models:", models)
    else:
        print(data)
except Exception as e:
    print("Error:", e)
