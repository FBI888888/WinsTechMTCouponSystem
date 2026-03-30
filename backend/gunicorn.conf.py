# gunicorn.conf.py
bind = "127.0.0.1:8000"
workers = 4
worker_class = "uvicorn.workers.UvicornWorker"
timeout = 120
keepalive = 5
pidfile = "/tmp/mtcoupon.pid"
errorlog = "/www/wwwlogs/mtcoupon_error.log"
accesslog = "/www/wwwlogs/mtcoupon_access.log"
loglevel = "info"
