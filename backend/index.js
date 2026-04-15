const express = require("express");
const pool = require("./db");
require("dotenv").config();

const app = express();
app.use(express.json());

app.get("/",(req,res) => {
    res.send("API running");
})

const rateLimit = require("express-rate-limit");
const shortenLimiter = rateLimit({
    windowMs: 15*60*1000,
    max: 50,
    message: "Too many requests, try again later",
});

app.get("/test-db",async(req,res)=>{
    try{
        const result = await pool.query("SELECT NOW()");
        res.json(result.rows[0]);
    }catch(err){
        res.status(500).send(err.message);
    }
});

app.listen(process.env.PORT, () => {
    console.log(`Server running on port ${process.env.PORT}`);
});


const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function encodeBase62(num){
    let str = "";
    while(num > 0){
        str = chars[num % 62]+ str;
        num = Math.floor(num/62);
    }
    return str || "0";
}

app.post("/shorten", shortenLimiter, async(req,res) => {
    try{
        const { url, expiresInDays } = req.body;
        
        let expiresAt = null;
        if(expiresInDays){
            expiresAt = new Date();;
            expiresAt.setDate(expiresAt.getDate() + expiresInDays)
        }

        if(!url) return res.status(400).send("URL required");
        try{
            new URL(url);
        }catch{
            return res.status(400).send("Invalid URL");
        }

        const existing = await pool.query("SELECT short_code FROM urls WHERE original_url=$1",[url]);

        if(existing.rows.length > 0){
            return res.json({shortUrl: `${process.env.BASE_URL}/${existing.rows[0].short_code}`});
        }

        const result = await pool.query("INSERT INTO urls(original_url, short_code, expires_at) VALUES($1,'',$2) RETURNING id",[url,expiresAt]);

        // console.log("Post Result ",result)
        const id = result.rows[0].id;
        const shortCode = encodeBase62(id);

        await pool.query("UPDATE urls SET short_code=$1 WHERE id=$2",[shortCode,id]);

        res.json({shortUrl: `${process.env.BASE_URL}/${shortCode}`,})
    }catch(err){
        res.status(500).send(err.message);
    }
});

app.get("/:code",async(req,res) => {
    try{
        const { code } = req.params;
        const result = await pool.query("SELECT * FROM urls WHERE short_code=$1 AND (expires_at IS NULL OR expires_at > NOW())",[code]);

        // console.log("Get Result ",result)
        if(result.rows.length === 0){
            return res.status(404).send("Not found");
        }
        const urlData = result.rows[0];

        console.log("URL DATA: ", urlData)
        await pool.query("UPDATE urls SET click_count = click_count + 1 WHERE id=$1",[urlData.id]);
        res.redirect(urlData.original_url);
    }catch(err){
        res.status(500).send(err.message);
    }
});


