const assert = require('node:assert/strict');
module.exports=async function(page,base){
 await page.goto(base+'/');
 await page.click('#addBtn');await page.fill('#form [name=name]','검증 프로젝트 <b>x</b>');
 await page.selectOption('#form [name=category]',{index:1});
 await page.fill('#form [name=quotedPrice]','100000');await page.fill('#form [name=estimatedHours]','5');await page.fill('#form [name=actualHours]','6');
 await page.click('#form [type=submit]');
 const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('estimate-check:v1')));
 assert.equal((await saved()).length,1);assert.equal((await saved())[0].actualHours,6);
 assert.equal(await page.locator('#list b').filter({hasText:'x'}).count(),0,'User text is not markup');
 await page.reload();assert.equal((await saved())[0].name,'검증 프로젝트 <b>x</b>');
 await page.getByRole('button',{name:'검증 프로젝트 <b>x</b> 복제',exact:true}).click();assert.equal((await saved()).length,2);
 const [file]=await Promise.all([page.waitForEvent('download'),page.click('#backupBtn')]);
 const fs=require('node:fs');const backup=fs.readFileSync(await file.path(),'utf8');
 assert.equal(JSON.parse(backup).records.length,2);
 await page.setInputFiles('#restoreFile',{name:'backup.json',mimeType:'application/json',buffer:Buffer.from(backup)});await page.click('#cOk');
 assert.equal((await saved()).length,2);assert.equal(new Set((await saved()).map(r=>r.id)).size,2);
};
