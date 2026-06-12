import os
import sqlalchemy
from google.cloud.sql.connector import Connector

connector = Connector()

def getconn():
    return connector.connect(
        os.environ["INSTANCE_CONNECTION_NAME"],
        "pymysql",
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASS"],
        db=os.environ["DB_NAME"],
    )

engine = sqlalchemy.create_engine(
    "mysql+pymysql://",
    creator=getconn,
    pool_pre_ping=True,
)
