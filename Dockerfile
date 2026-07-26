
FROM python:3.12-slim AS develop-py
WORKDIR /root/running_page
COPY ./requirements.txt /root/running_page/requirements.txt
RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && apt-get purge -y --auto-remove \
  && rm -rf /var/lib/apt/lists/* \
  && pip3 install -i https://mirrors.aliyun.com/pypi/simple/ pip -U \
  && pip3 config set global.index-url https://mirrors.aliyun.com/pypi/simple/ \
  && pip3 install -r requirements.txt

FROM node:24 AS develop-node
WORKDIR /root/running_page
COPY ./package.json /root/running_page/package.json
COPY ./pnpm-lock.yaml /root/running_page/pnpm-lock.yaml
RUN npm config set registry https://registry.npmmirror.com \
  && corepack enable \
  && COREPACK_NPM_REGISTRY=https://registry.npmmirror.com pnpm install

FROM develop-py AS data
COPY --from=develop-node /usr/local/bin/node /usr/local/bin/node
ARG app
ARG nike_refresh_token
ARG secret_string
ARG client_id
ARG client_secret
ARG refresh_token
ARG YOUR_NAME
ARG keep_phone_number
ARG keep_password

WORKDIR /root/running_page
COPY . /root/running_page/
ARG DUMMY=unknown
RUN DUMMY=${DUMMY}; \
  echo $app ; \
  if [ "$app" = "NRC" ] ; then \
  python3 run_page/nike_sync.py ${nike_refresh_token}; \
  elif [ "$app" = "Garmin" ] ; then \
  python3 run_page/garmin_sync.py ${secret_string} ; \
  elif [ "$app" = "Garmin-CN" ] ; then \
  python3 run_page/garmin_sync.py ${secret_string} --is-cn ; \
  elif [ "$app" = "Strava" ] ; then \
  python3 run_page/strava_sync.py ${client_id} ${client_secret} ${refresh_token};\
  elif [ "$app" = "Nike_to_Strava" ] ; then \
  python3  run_page/nike_to_strava_sync.py ${nike_refresh_token} ${client_id} ${client_secret} ${refresh_token};\
  elif [ "$app" = "Keep" ] ; then \
  python3 run_page/keep_sync.py ${keep_phone_number} ${keep_password} --with-gpx;\
  else \
  echo "Unknown app" ; \
  fi
RUN node scripts/generate-activity-artifacts.mjs generate \
  --mode running \
  --input src/static/activities.json \
  --published-at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --data-output public/data \
  --assets-output assets \
  --python python3 \
  --athlete "${YOUR_NAME:-Dylan}"


FROM develop-node AS frontend-build
WORKDIR /root/running_page
COPY --from=data /root/running_page /root/running_page
RUN pnpm run build

FROM nginx:alpine AS web
COPY --from=frontend-build /root/running_page/dist /usr/share/nginx/html/
COPY --from=frontend-build /root/running_page/assets /usr/share/nginx/html/assets
COPY nginx.conf /etc/nginx/conf.d/default.conf
