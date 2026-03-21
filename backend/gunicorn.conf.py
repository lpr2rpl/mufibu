# Gunicorn configuration for MuFiBu backend
import multiprocessing

bind = "127.0.0.1:8000"
workers = multiprocessing.cpu_count() * 2 + 1
worker_class = "uvicorn.workers.UvicornWorker"
timeout = 120
keepalive = 5
accesslog = "/var/log/mufibu/backend-access.log"
errorlog  = "/var/log/mufibu/backend-error.log"
loglevel  = "info"
pidfile   = "/var/run/mufibu/backend.pid"
user      = "mufibu"
group     = "mufibu"
