# Guia Rápido de Deploy na VPS (Acesso Direto pelo IP)

## 1. Liberar portas no Firewall da VPS
Libere no `ufw` (e/ou no painel da sua hospedagem):
```bash
sudo ufw allow 5000/tcp
sudo ufw allow 7880/tcp
sudo ufw allow 7881/tcp
sudo ufw allow 7882/udp
sudo ufw allow 50600:50700/udp
```

## 2. Enviar o projeto para a VPS
Clone ou envie a pasta `jdisc` para a VPS (ex.: `/opt/jdisc` ou `~/jdisc`) e entre nela:
```bash
cd ~/jdisc
```

## 3. Configurar o `.env`
```bash
cp infra/.env.prod.example .env
nano .env
```
Troque obrigatoriamente:
- `LIVEKIT_PUBLIC_URL=ws://SEU_IP_DA_VPS:7880` *(coloque o IP público da sua VPS)*
- `POSTGRES_PASSWORD`
- `JWT_SECRET` *(mínimo 32 caracteres)*
- `LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET` *(mínimo 32 caracteres)*
- `INVITE_CODE` *(código que seus amigos vão usar para criar conta)*

## 4. Subir a stack
```bash
docker compose -f infra/docker-compose.prod.yml --env-file .env up -d --build
```

## 5. Verificar se está rodando
```bash
docker compose -f infra/docker-compose.prod.yml ps
curl http://localhost:5000/health
```
Deve retornar `Healthy`.

## 6. Conectar no app Windows (`jdisc.exe`)
No campo **ENDEREÇO DO SERVIDOR JDISC**, informe:
```text
http://SEU_IP_DA_VPS:5000
```
E passe para seus amigos o `INVITE_CODE` configurado no `.env`.
